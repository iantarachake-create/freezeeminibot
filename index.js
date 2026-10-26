const express = require('express');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const manager = require('./lib/manager');
const handler = require('./lib/handler');
const { createStore } = require('./lib/store');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// ---- tiny per-IP rate limiter for the pairing endpoint
const hits = new Map();
function limit(max, windowMs) {
  return (req, res, next) => {
    const k = req.ip, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests, wait a minute.' });
    arr.push(now); hits.set(k, arr); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

// ---- public site + API
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const pair = async (req, res) => {
  const r = await manager.requestPairing(req.query.number);
  res.status(r.error ? 400 : 200).json(r);
};
app.get('/api/pair', limit(6, 60000), pair);
app.get('/code', limit(6, 60000), pair);               // legacy path used by old pair page / other bots

app.get('/api/status', (req, res) => {
  const s = manager.get(req.query.number);
  res.json(s ? { status: s.status, connected: s.status === 'open', uptimeSec: s.uptimeSec } : { status: 'none', connected: false });
});
app.get('/api/stats', (req, res) => res.json({ online: manager.openCount(), total: manager.count(), capacity: config.MAX_SESSIONS }));
app.get('/health', (req, res) => res.json({ ok: true, online: manager.openCount(), total: manager.count(), uptime: Math.floor(process.uptime()) }));
app.get('/ping', (req, res) => res.send('pong'));

// ---- admin (needs ADMIN_KEY)
const admin = (req, res, next) => {
  if (!config.ADMIN_KEY) return res.status(404).end();
  if ((req.get('x-admin-key') || req.query.key) !== config.ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
};
app.get('/api/admin/sessions', admin, (req, res) => res.json(manager.list()));
app.get('/api/admin/disconnect', admin, async (req, res) => {
  const ok = await manager.destroy(req.query.number, { wipe: true, logout: true });
  res.json({ ok });
});
app.get('/api/admin/restart', admin, async (req, res) => res.json({ ok: await manager.restart(req.query.number) }));

// ---- boot
(async () => {
  const store = await createStore();
  handler.loadPlugins();
  await manager.init(store, handler);

  const server = app.listen(config.PORT, () => console.log(`🚀 ${config.BOT_NAME} on :${config.PORT}`));
  server.keepAliveTimeout = 65000;

  manager.restoreAll().catch((e) => console.error('restore error:', e));

  // keep free hosts awake
  if (config.APP_URL) {
    setInterval(() => axios.get(config.APP_URL.replace(/\/$/, '') + '/health', { timeout: 15000 }).catch(() => {}), 4 * 60 * 1000).unref();
  }

  const stop = async (sig) => {
    console.log(`\n${sig}: closing sessions (kept for next start)...`);
    await manager.shutdown().catch(() => {});
    await store.close?.();
    server.close(); process.exit(0);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
})();

// one bad plugin/socket must never take every user down
process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
