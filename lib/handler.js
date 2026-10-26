/**
 * Per-session event handlers. Everything here receives the session object `s`
 * (settings, caches, socket) so many numbers can run side by side without
 * sharing state.
 */
const bl = require('@whiskeysockets/baileys');
const { getContentType, jidNormalizedUser, jidDecode } = bl;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const events = require('../command');
const { sms } = require('./msg');

const MSG_CACHE = 800;
const SEEN_MAX = 2000;
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const serial = () => crypto.randomBytes(8).toString('hex').toUpperCase();

// ------------------------------------------------------------ plugins
const loaded = [];
function loadPlugins() {
  const dir = path.join(__dirname, '..', 'plugins');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  let ok = 0;
  for (const f of files) {
    try { require(path.join(dir, f)); ok++; loaded.push(f); }
    catch (e) { console.error(`❌ plugin ${f} skipped: ${e.message.split('\n')[0]}`); }
  }
  // fast lookup: pattern + aliases
  const map = new Map();
  for (const c of events.commands) {
    if (c.pattern) map.set(String(c.pattern).toLowerCase(), c);
    for (const a of c.alias || []) map.set(String(a).toLowerCase(), c);
  }
  events.map = map;
  console.log(`📦 Plugins: ${ok}/${files.length} loaded, ${map.size} command names`);
}

// ------------------------------------------------------------ helpers
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const t = getContentType(m);
    if (t === 'ephemeralMessage') m = m.ephemeralMessage.message;
    else if (t === 'viewOnceMessage') m = m.viewOnceMessage.message;
    else if (t === 'viewOnceMessageV2') m = m.viewOnceMessageV2.message;
    else if (t === 'viewOnceMessageV2Extension') m = m.viewOnceMessageV2Extension.message;
    else if (t === 'documentWithCaptionMessage') m = m.documentWithCaptionMessage.message;
    else break;
  }
  return m;
}

async function groupInfo(s, jid) {
  const hit = s.groups.get(jid);
  if (hit && Date.now() - hit.t < 120000) return hit.data;
  const data = await s.sock.groupMetadata(jid);
  s.groups.set(jid, { t: Date.now(), data });
  if (s.groups.size > 300) s.groups.delete(s.groups.keys().next().value);
  return data;
}

const getGroupAdmins = (parts) => parts.filter((p) => p.admin).map((p) => p.id);

function remember(s, mek) {
  if (!mek.key?.id || !mek.message) return;
  s.msgs.set(mek.key.id, mek);
  if (s.msgs.size > MSG_CACHE) s.msgs.delete(s.msgs.keys().next().value);
}

// ------------------------------------------------------------ status
async function handleStatus(s, mek) {
  const sock = s.sock, st = s.settings;
  if (mek.key.fromMe) return;
  if (st.AUTO_VIEW_STATUS === 'true') await sock.readMessages([mek.key]).catch(() => {});
  if (st.AUTO_LIKE_STATUS === 'true' && mek.key.participant) {
    const me = jidNormalizedUser(sock.user.id);
    await sleep(500 + Math.random() * 1500);
    await sock.sendMessage('status@broadcast', { react: { text: rnd(config.AUTO_LIKE_EMOJI), key: mek.key } },
      { statusJidList: [mek.key.participant, me] }).catch(() => {});
  }
  if (st.AUTO_STATUS_REPLY === 'true' && mek.key.participant) {
    await sock.sendMessage(mek.key.participant, { text: config.AUTO_STATUS_MSG }, { quoted: mek }).catch(() => {});
  }
}

// ------------------------------------------------------------ anti-delete
async function handleRevoke(s, mek) {
  if (s.settings.ANTI_DELETE !== 'true') return;
  const proto = mek.message.protocolMessage;
  const orig = s.msgs.get(proto?.key?.id);
  if (!orig || orig.key.fromMe) return;
  const sock = s.sock;
  const me = jidNormalizedUser(sock.user.id);
  const chat = orig.key.remoteJid;
  const who = orig.key.participant || chat;
  let where = 'private chat';
  if (chat.endsWith('@g.us')) { try { where = 'group: ' + (await groupInfo(s, chat)).subject; } catch { where = 'a group'; } }
  await sock.sendMessage(me, {
    text: `🚫 *ANTI-DELETE*\n👤 @${who.split('@')[0]}\n💬 ${where}\n🕒 ${new Date().toLocaleString()}\n\n> ${config.BOT_FOOTER}`,
    mentions: [who]
  }).catch(() => {});
  await sock.sendMessage(me, { forward: orig }).catch(() => {});
}

// ------------------------------------------------------------ main upsert
async function onUpsert(s, upsert) {
  if (upsert.type !== 'notify') {
    for (const m of upsert.messages || []) remember(s, m);
    return;
  }
  for (const mek of upsert.messages || []) {
    try { await processOne(s, mek); } catch (e) { console.error(`[${s.number}] msg error:`, e.message); }
  }
}

async function processOne(s, mek) {
  const sock = s.sock;
  if (!sock || !mek.message || !mek.key) return;
  const id = mek.key.id;
  if (s.seen.has(id)) return;                       // WA sometimes redelivers after reconnect
  s.seen.add(id);
  if (s.seen.size > SEEN_MAX) s.seen.delete(s.seen.values().next().value);

  mek.message = unwrap(mek.message);
  if (!mek.message) return;
  remember(s, mek);

  const from = mek.key.remoteJid;
  if (from === 'status@broadcast') return handleStatus(s, mek);
  if (from.endsWith('@newsletter')) return;
  if (mek.message.protocolMessage) {
    if (mek.message.protocolMessage.type === 0) await handleRevoke(s, mek);
    return;
  }
  if (mek.message.reactionMessage || mek.message.senderKeyDistributionMessage && Object.keys(mek.message).length === 1) return;

  const st = s.settings;
  const m = sms(sock, mek);
  const type = getContentType(mek.message);
  const body = (m.body || '').toString();

  const meJid = jidNormalizedUser(sock.user.id);
  const botNumber = meJid.split('@')[0];
  const isGroup = from.endsWith('@g.us');
  const sender = mek.key.fromMe ? meJid : (mek.key.participant || mek.key.remoteJid);
  const senderNumber = sender.split('@')[0];
  const pushname = mek.pushName || 'User';

  // owner = the account this session belongs to (+ optional sudo list stored per session)
  const sudo = (st.SUDO || '').split(',').filter(Boolean);
  const isMe = !!mek.key.fromMe || senderNumber === botNumber;
  const isOwner = isMe || sudo.includes(senderNumber);

  if (st.READ_MESSAGE === 'true' && !mek.key.fromMe) sock.readMessages([mek.key]).catch(() => {});

  const prefix = config.PREFIX;
  const isCmd = body.startsWith(prefix);
  const cmdName = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
  const args = body.trim().split(/ +/).slice(1);
  const q = args.join(' ');

  if (st.AUTO_REACT === 'true' && !mek.key.fromMe && !isCmd && body) {
    sock.sendMessage(from, { react: { text: rnd(['❤️', '🔥', '😂', '👍', '😍', '✨', '💯']), key: mek.key } }).catch(() => {});
  }

  const mode = (st.MODE || config.WORK_TYPE || 'public').toLowerCase();
  if (mode === 'private' && !isOwner && !mek.key.fromMe) return;

  // lazily resolved group data
  let groupMetadata = null, groupName = null, participants = null, groupAdmins = null, isBotAdmins = null, isAdmins = null;
  const needGroup = isGroup && (isCmd || events.commands.some((c) => c.on));
  if (needGroup) {
    try {
      groupMetadata = await groupInfo(s, from);
      groupName = groupMetadata.subject;
      participants = groupMetadata.participants;
      groupAdmins = getGroupAdmins(participants);
      isBotAdmins = groupAdmins.includes(meJid);
      isAdmins = groupAdmins.includes(sender);
    } catch {}
  }

  if (isCmd || type === 'conversation') {
    if (st.AUTO_TYPING === 'true') sock.sendPresenceUpdate('composing', from).catch(() => {});
    else if (st.AUTO_RECORDING === 'true') sock.sendPresenceUpdate('recording', from).catch(() => {});
  }

  const myquoted = {
    key: { remoteJid: 'status@broadcast', participant: '13135550002@s.whatsapp.net', fromMe: false, id: serial() },
    message: { contactMessage: { displayName: `© ${config.BOT_NAME}`, vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${config.BOT_NAME}\nORG:${config.BOT_NAME};\nTEL;type=CELL;type=VOICE;waid=13135550002:13135550002\nEND:VCARD` } },
    messageTimestamp: Math.floor(Date.now() / 1000), status: 1
  };
  const reply = (text) => sock.sendMessage(from, { text: String(text) }, { quoted: mek });
  const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});

  const ctx = {
    from, quoted: mek, body, isCmd, command: cmdName, args, q, text: q, isGroup, sender,
    senderNumber, botNumber, botNumber2: meJid, pushname, isMe, isOwner, isCreator: isOwner,
    isSuperUser: isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
    reply, react, l: reply, config, myquoted, session: s, manager: require('./manager'), type
  };

  // ---- commands
  if (isCmd && cmdName) {
    const cmd = events.map.get(cmdName);
    if (cmd) {
      if (cmd.react) react(cmd.react);
      Promise.resolve()
        .then(() => cmd.function(sock, mek, m, ctx))
        .catch((e) => console.error(`[${s.number}] .${cmdName} failed:`, e.message));
    }
  }

  // ---- passive handlers (on: body / text / image / sticker)
  for (const c of events.commands) {
    if (!c.on) continue;
    const run = (c.on === 'body' && body) ||
                (c.on === 'text' && q) ||
                ((c.on === 'image' || c.on === 'photo') && type === 'imageMessage') ||
                (c.on === 'sticker' && type === 'stickerMessage');
    if (run) Promise.resolve().then(() => c.function(sock, mek, m, ctx)).catch((e) => console.error(`[${s.number}] on:${c.on} failed:`, e.message));
  }
}

// ------------------------------------------------------------ calls / groups / welcome
async function onCall(s, calls) {
  if (s.settings.ANTI_CALL !== 'true') return;
  for (const c of calls) {
    if (c.status !== 'offer') continue;
    await s.sock.rejectCall(c.id, c.from).catch(() => {});
    await s.sock.sendMessage(c.from, { text: s.settings.REJECT_MSG || config.REJECT_MSG }).catch(() => {});
  }
}

async function onGroupParticipants(s, update) {
  const { groupEvents } = require('./group-config');
  await groupEvents(s.sock, update, s.settings);
}

async function onWelcome(s) {
  const me = jidNormalizedUser(s.sock.user.id);
  const text =
`╔═══════════════════╗
║ 🤖 *${config.BOT_NAME.toUpperCase()}* CONNECTED
╠═══════════════════╣
║ 🔑 Prefix : ${config.PREFIX}
║ 📱 Number : ${s.number}
║ ⚙️ Settings: ${config.PREFIX}settings
║ 📜 Menu    : ${config.PREFIX}menu
║ 🚪 Logout  : ${config.PREFIX}logout
╚═══════════════════╝
> ${config.BOT_FOOTER}`;
  await sleep(2000);
  try { await s.sock.sendMessage(me, { image: { url: config.IMAGE_PATH }, caption: text }); }
  catch { await s.sock.sendMessage(me, { text }).catch(() => {}); }
}

module.exports = { loadPlugins, onUpsert, onCall, onGroupParticipants, onWelcome };
