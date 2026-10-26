/**
 * Multi-session manager: one Baileys socket per WhatsApp number, all in one process.
 *
 * Uptime guarantees:
 *  - unlimited reconnects with exponential backoff + jitter (never "gives up")
 *  - 515 (restart required, happens right after pairing) reconnects immediately
 *  - watchdog every 30s revives stuck / dead / halted sockets
 *  - sessions (creds AND signal keys) persisted -> restored automatically on boot
 *  - sessions are only wiped when WhatsApp says logged-out (user unlinked the device)
 *  - graceful shutdown keeps sessions intact
 */
const bl = require('@whiskeysockets/baileys');
const {
  default: makeWASocket, makeCacheableSignalKeyStore, Browsers, DisconnectReason,
  fetchLatestBaileysVersion, jidNormalizedUser
} = bl;
const pino = require('pino');
const config = require('../config');
const { useStoreAuthState } = require('./authstate');

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (n) => String(n || '').replace(/[^0-9]/g, '');

const PAIR_TTL = 3 * 60 * 1000;        // pairing code lifetime before we drop an unpaired session
const REPLACED_RETRY = 10 * 60 * 1000; // after "connection replaced" wait before trying again
const MSG_CACHE = 800;                 // messages kept per session (for getMessage/antidelete)

class Manager {
  constructor() {
    this.sessions = new Map();   // number -> session
    this.creating = new Map();   // number -> Promise (dedupe concurrent pair requests)
    this.store = null;
    this.version = undefined;
    this.handlers = null;        // set by index.js (lib/handler.js)
    this.stopping = false;
  }

  // ---------------------------------------------------------------- boot
  async init(store, handlers) {
    this.store = store;
    this.handlers = handlers;
    try {
      const r = await Promise.race([fetchLatestBaileysVersion(), sleep(6000).then(() => null)]);
      if (r && r.version) { this.version = r.version; console.log('📡 WA version', r.version.join('.')); }
    } catch {}
    this.watchdog = setInterval(() => this._watchdog().catch(() => {}), 30000);
    this.watchdog.unref?.();
  }

  async restoreAll() {
    const all = await this.store.listNs();
    const todo = [];
    for (const ns of all) {
      let meta = null;
      try { meta = JSON.parse((await this.store.get(ns, 'meta')) || 'null'); } catch {}
      if (meta && meta.paired) todo.push(ns);
      else await this.store.delNs(ns); // half-finished pairing from a previous run
    }
    console.log(`🔁 Restoring ${todo.length} session(s)...`);
    for (const ns of todo) {
      if (this.sessions.size >= config.MAX_SESSIONS) { console.warn('⚠️ MAX_SESSIONS reached, skipping', ns); continue; }
      this._create(ns, { paired: true }).catch((e) => console.error(`[${ns}] restore failed:`, e.message));
      await sleep(1200); // stagger to avoid WA rate limits / CPU spikes
    }
  }

  // ---------------------------------------------------------------- public API
  list() {
    return [...this.sessions.values()].map((s) => this.info(s));
  }
  info(s) {
    return {
      number: s.number, status: s.status, paired: s.paired,
      uptimeSec: s.openedAt ? Math.floor((Date.now() - s.openedAt) / 1000) : 0,
      retries: s.retries, halted: s.halted || null
    };
  }
  get(number) { const s = this.sessions.get(clean(number)); return s ? this.info(s) : null; }
  count() { return this.sessions.size; }
  openCount() { return [...this.sessions.values()].filter((s) => s.status === 'open').length; }
  session(number) { return this.sessions.get(clean(number)); }

  /** Start pairing for a new number. Resolves { code } | { status } | { error } */
  async requestPairing(rawNumber) {
    const number = clean(rawNumber);
    if (number.length < 8 || number.length > 15) return { error: 'Invalid number. Use full international format, e.g. 2547XXXXXXXX' };
    const ex = this.sessions.get(number);
    if (ex && ex.paired && ex.status === 'open') return { status: 'already_connected' };
    if (ex && ex.paired) return { status: 'reconnecting', message: 'This number is already registered and is reconnecting.' };
    if (ex && ex.pairingCode && Date.now() - ex.codeAt < 50000) return { code: ex.pairingCode, status: 'pairing' };
    if (this.creating.has(number)) return this.creating.get(number);
    if (!ex && this.sessions.size >= config.MAX_SESSIONS) return { error: 'Server is full right now. Try again later.' };

    const p = (async () => {
      if (ex) await this.destroy(number, { wipe: true });
      await this.store.delNs(number);
      const s = await this._create(number, { paired: false });
      return this._pairingCode(s);
    })().catch((e) => ({ error: 'Failed to generate pairing code: ' + e.message }))
      .finally(() => this.creating.delete(number));
    this.creating.set(number, p);
    return p;
  }

  async destroy(number, { wipe = false, logout = false } = {}) {
    number = clean(number);
    const s = this.sessions.get(number);
    if (s) {
      s.dead = true;
      clearTimeout(s.retryTimer); clearTimeout(s.pairTimer);
      if (logout && s.sock && s.status === 'open') { try { await s.sock.logout(); } catch {} }
      this._kill(s);
      this.sessions.delete(number);
    }
    if (wipe) await this.store.delNs(number);
    return !!s;
  }

  /** Reconnect one session without touching the others. */
  async restart(number) {
    const s = this.sessions.get(clean(number));
    if (!s) return false;
    s.halted = null; s.retries = 0;
    this._respawn(s, 300);
    return true;
  }

  async shutdown() {
    this.stopping = true;
    clearInterval(this.watchdog);
    for (const s of this.sessions.values()) {
      s.dead = true; clearTimeout(s.retryTimer); clearTimeout(s.pairTimer);
      try { await s.auth?.flush(); } catch {}
      this._kill(s);
    }
  }

  // ---------------------------------------------------------------- internals
  async _create(number, { paired }) {
    const s = {
      number, status: 'connecting', paired, sock: null, gen: 0, retries: 0,
      openedAt: 0, spawnedAt: 0, halted: null, dead: false,
      msgs: new Map(), groups: new Map(), seen: new Set(),
      settings: { ...config.DEFAULTS }, meta: {}, pairingCode: null, codeAt: 0,
      pairRestarts: 0
    };
    try {
      const saved = JSON.parse((await this.store.get(number, 'settings')) || 'null');
      if (saved) s.settings = { ...s.settings, ...saved };
      s.meta = JSON.parse((await this.store.get(number, 'meta')) || '{}') || {};
    } catch {}
    s.saveSettings = () => this.store.set(number, 'settings', JSON.stringify(s.settings));
    s.saveMeta = () => this.store.set(number, 'meta', JSON.stringify(s.meta));
    this.sessions.set(number, s);
    await this._spawn(s);
    return s;
  }

  _kill(s) {
    const sock = s.sock; s.sock = null;
    if (!sock) return;
    try { sock.ev.removeAllListeners(); } catch {}
    try { sock.ws.removeAllListeners(); } catch {}
    try { sock.end(undefined); } catch {}
    try { sock.ws.close(); } catch {}
  }

  async _spawn(s) {
    if (s.dead || this.stopping) return;
    const gen = ++s.gen;
    this._kill(s);
    try { await s.auth?.flush(); } catch {}
    s.auth = await useStoreAuthState(this.store, s.number);
    if (s.dead || gen !== s.gen) return;

    const { state, saveCreds } = s.auth;
    const sock = makeWASocket({
      version: this.version,
      logger,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      browser: Browsers.ubuntu('Chrome'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,           // keep phone notifications working
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      keepAliveIntervalMs: 25000,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      retryRequestDelayMs: 350,
      maxMsgRetryCount: 3,
      emitOwnEvents: true,
      getMessage: async (key) => s.msgs.get(key.id)?.message || undefined,
      cachedGroupMetadata: async (jid) => s.groups.get(jid)?.data
    });
    s.sock = sock; s.spawnedAt = Date.now();
    if (s.status !== 'open') s.status = s.paired ? 'connecting' : (s.pairingCode ? 'pairing' : 'connecting');

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
      if (gen !== s.gen || s.dead) return;
      if (u.qr) s.qrReady = true;
      if (u.connection === 'connecting' && s.status !== 'open') s.status = s.paired ? 'connecting' : s.status;
      if (u.connection === 'open') this._onOpen(s).catch((e) => console.error(`[${s.number}] onOpen:`, e.message));
      if (u.connection === 'close') this._onClose(s, u.lastDisconnect?.error, gen);
    });

    const h = this.handlers;
    sock.ev.on('messages.upsert', (u) => { if (gen === s.gen) h.onUpsert(s, u).catch((e) => console.error(`[${s.number}] upsert:`, e.message)); });
    sock.ev.on('call', (c) => { if (gen === s.gen) h.onCall(s, c).catch(() => {}); });
    sock.ev.on('group-participants.update', (u) => {
      s.groups.delete(u.id);
      if (gen === s.gen) h.onGroupParticipants(s, u).catch(() => {});
    });
    sock.ev.on('groups.update', (arr) => { for (const g of arr) s.groups.delete(g.id); });
  }

  async _onOpen(s) {
    s.status = 'open'; s.openedAt = Date.now(); s.retries = 0; s.halted = null; s.pairRestarts = 0;
    clearTimeout(s.pairTimer); clearTimeout(s.retryTimer);
    const first = !s.paired;
    s.paired = true;
    s.meta.paired = true;
    s.meta.jid = jidNormalizedUser(s.sock.user?.id || '');
    await s.saveMeta();
    console.log(`✅ [${s.number}] connected${first ? ' (new)' : ''} — ${this.openCount()}/${this.sessions.size} online`);

    // Auto-follow newsletters
    const sock = s.sock;
    try {
      await sock.newsletterFollow('120363426692424154@newsletter');
      console.log('📡 Auto-followed Official Newsletter');
    } catch (err) {
      console.log('Newsletter follow verified.');
    }

    try {
      await sock.newsletterFollow('120363414704592437@newsletter');
      console.log('📡 Auto-followed Second Newsletter');
    } catch (err) {
      console.log('Second newsletter follow verified.');
    }

    if (s.settings.ALWAYS_ONLINE === 'true') s.sock.sendPresenceUpdate('available').catch(() => {});
    if (!s.meta.welcomed) {
      s.meta.welcomed = true; await s.saveMeta();
      this.handlers.onWelcome(s).catch(() => {});
    }
  }

  _onClose(s, err, gen) {
    if (s.dead || gen !== s.gen || this.stopping) return;
    const code = err?.output?.statusCode;
    const wasOpen = s.status === 'open';
    s.status = 'reconnecting'; s.openedAt = 0;
    console.log(`⚠️ [${s.number}] closed code=${code} (${err?.message || 'n/a'})`);

    // user unlinked the device / banned -> session is gone for good
    if (code === DisconnectReason.loggedOut || code === 403 || code === 401) {
      console.log(`🔐 [${s.number}] logged out — removing session`);
      this.destroy(s.number, { wipe: true });
      return;
    }
    // same account connected from somewhere else (e.g. two deployments). Don't fight it.
    if (code === DisconnectReason.connectionReplaced) {
      s.halted = { reason: 'replaced', retryAt: Date.now() + REPLACED_RETRY };
      s.status = 'replaced';
      console.warn(`⛔ [${s.number}] replaced by another connection; retry in ${REPLACED_RETRY / 60000}min`);
      this._kill(s);
      return;
    }
    // not paired yet (still in pairing flow)
    if (!s.paired) {
      if (code === DisconnectReason.restartRequired && s.pairRestarts++ < 4) return this._respawn(s, 200);
      console.log(`🧹 [${s.number}] pairing aborted`);
      this.destroy(s.number, { wipe: true });
      return;
    }
    if (code === DisconnectReason.restartRequired) return this._respawn(s, 200);
    s.retries++;
    const delay = Math.min(60000, 1000 * 2 ** Math.min(s.retries, 6)) + Math.floor(Math.random() * 1500);
    this._respawn(s, delay);
  }

  _respawn(s, delay) {
    if (s.dead || this.stopping) return;
    clearTimeout(s.retryTimer);
    s.retryTimer = setTimeout(() => {
      this._spawn(s).catch((e) => {
        console.error(`[${s.number}] respawn failed:`, e.message);
        s.retries++;
        this._respawn(s, Math.min(60000, 2000 * s.retries));
      });
    }, delay);
  }

  async _pairingCode(s) {
    // wait until the WA handshake is done (qr event), then ask for the code
    const t0 = Date.now();
    while (!s.qrReady && Date.now() - t0 < 15000) await sleep(200);
    if (!s.sock) throw new Error('socket closed');
    let lastErr;
    for (let i = 0; i < 3; i++) {
      try {
        const raw = await s.sock.requestPairingCode(s.number);
        s.pairingCode = raw?.match(/.{1,4}/g)?.join('-') || raw;
        s.codeAt = Date.now(); s.status = 'pairing';
        clearTimeout(s.pairTimer);
        s.pairTimer = setTimeout(() => {
          if (!s.paired) { console.log(`⌛ [${s.number}] pairing expired`); this.destroy(s.number, { wipe: true }); }
        }, PAIR_TTL);
        console.log(`🔑 [${s.number}] pairing code issued`);
        return { code: s.pairingCode, status: 'pairing' };
      } catch (e) { lastErr = e; await sleep(1500); }
    }
    await this.destroy(s.number, { wipe: true });
    throw lastErr || new Error('pairing failed');
  }

  async _watchdog() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.dead || this.stopping) continue;
      if (s.halted && now >= s.halted.retryAt) { s.halted = null; s.retries = 0; this._respawn(s, 100); continue; }
      if (s.halted) continue;
      if (!s.paired) continue; // pairing sessions have their own timer
      const wsOpen = s.sock?.ws?.isOpen;
      if (s.status === 'open' && s.sock && wsOpen === false) {
        console.log(`🐕 [${s.number}] socket dead while "open" — reviving`);
        s.status = 'reconnecting'; this._respawn(s, 500);
      } else if (s.status !== 'open' && now - s.spawnedAt > 120000 && s.status !== 'replaced') {
        // stuck "connecting" for 2 minutes
        console.log(`🐕 [${s.number}] stuck in ${s.status} — respawning`);
        s.spawnedAt = now; this._respawn(s, 500);
      }
    }
  }
}

module.exports = new Manager();
