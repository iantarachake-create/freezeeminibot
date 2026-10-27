'use strict';
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const engine = require('./lib/freezerEngine');
const userConfigLib = require('./lib/userConfig');
const store = require('./lib/store');
const { SessionManager: manager, HttpError } = require('./lib/sessionManager');

const PORT = process.env.PORT || 8000;
const BOOT = Date.now();

for (const d of ['temp', 'tmp']) fs.mkdirSync(path.join(__dirname, d), { recursive: true });

// The sticker plugins run the `ffmpeg` command; most hosts don't have it, so use the bundled binary.
try {
    const ff = require('@ffmpeg-installer/ffmpeg').path;
    process.env.PATH = path.dirname(ff) + path.delimiter + process.env.PATH;
} catch { /* optional */ }

// ---- plugins (same loader as the original: every file in plugins/ registers its commands) ----
const events = require('./command');
const pluginsDir = path.join(__dirname, 'plugins');
const files = fs.readdirSync(pluginsDir).filter(file => file.endsWith('.js'));
console.log(`📦 Loading ${files.length} plugins...`);
for (const file of files) {
    try {
        require(path.join(pluginsDir, file));
    } catch (e) {
        console.error(`❌ Failed to load plugin ${file}:`, e.message);
    }
}

// Commands that act on the WHOLE SERVER (restart/stop it, replace its code, install code from the internet).
// With many users every linked account is an "owner", so these must not exist. The plugin files are untouched;
// only these commands are not registered.
const BLOCKED = new Set(['shutdown', 'restart', 'rebot', 'reboot', 'update', 'install', 'addplugin', 'installplugin', 'deleteplugin']);
const before = events.commands.length;
for (let i = events.commands.length - 1; i >= 0; i--) {
    const c = events.commands[i];
    if (BLOCKED.has(c.pattern) || (c.alias || []).some(a => BLOCKED.has(a))) events.commands.splice(i, 1);
}
console.log(`🧩 ${events.commands.length} commands ready (${before - events.commands.length} server-wide commands disabled)`);

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => { // same as the original `cors()` default
    res.set('Access-Control-Allow-Origin', '*');
    next();
});
app.use(express.json({ limit: '20kb' }));

// ---- tiny in-memory rate limiter (per IP + route) ----
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
    const key = req.ip + '|' + req.path;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
        return res.status(429).json({ error: 'Too many requests. Please wait a few minutes.' });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
};
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (!v.some(t => now - t < 15 * 60 * 1000)) hits.delete(k);
}, 10 * 60 * 1000).unref();

const digits = v => String(v || '').replace(/[^0-9]/g, '');
const sessionOf = n => manager.sessions.get(n);
const statusOf = n => {
    const s = sessionOf(n);
    const isConnected = !!s && s.status === 'open';
    const t = isConnected ? s.lastOpen : null;
    return {
        isConnected,
        connectionTime: t ? new Date(t).toLocaleString() : null,
        uptime: t ? Math.floor((Date.now() - t) / 1000) : 0
    };
};

// ---- admin (disabled unless ADMIN_PASSWORD / ADMIN_PASSWORD_HASH is set) ----
// These endpoints are public in the original (anyone could list or disconnect any number); now they need the password.
function adminAuth(req, res, next) {
    const hash = process.env.ADMIN_PASSWORD_HASH;
    const plain = process.env.ADMIN_PASSWORD;
    if (!hash && !plain) return res.status(404).json({ error: 'Not found' });
    const given = String(req.get('x-admin-password') || req.query.key || '');
    let ok = false;
    if (hash) {
        ok = require('bcryptjs').compareSync(given, hash);
    } else {
        const a = Buffer.from(given), b = Buffer.from(plain);
        ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

// ---- pages ----
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pair.html')));

// What a newly linked account starts with. Shown on the pairing page so people know before they link.
app.get('/info', (req, res) => {
    const d = userConfigLib.defaults();
    const items = [];
    if (d.AUTO_VIEW_STATUS === 'true') items.push({ text: 'View your contacts\' statuses automatically' });
    if (d.AUTO_LIKE_STATUS === 'true') items.push({ text: 'React to those statuses with emojis' });
    if (d.AUTO_STATUS_REPLY === 'true') items.push({ text: 'Reply to statuses' });
    if (d.READ_MESSAGE === 'true') items.push({ text: 'Mark your incoming messages as read' });
    if (d.AUTO_TYPING === 'true') items.push({ text: 'Show "typing…" when you receive messages' });
    if (d.AUTO_RECORDING === 'true') items.push({ text: 'Show "recording…" when you receive messages' });
    if (d.ANTI_CALL === 'true') items.push({ text: 'Reject your incoming calls' });
    if ((global.followChannels || []).length) items.push({ text: 'Follow the bot\'s WhatsApp channel (.autofollow off to stop)' });
    res.json({ items });
});

// ---- pairing (same API as the original page expects) ----
app.get('/code', limit(6, 10 * 60 * 1000), async (req, res) => {
    const number = digits(req.query.number);
    if (!req.query.number) return res.json({ error: 'Number required' });
    if (!/^\d{8,15}$/.test(number)) return res.json({ error: 'Failed to generate pairing code', details: 'Enter your full number with country code, digits only' });
    try {
        const code = await manager.pair(number);
        res.json({ code, status: 'new_pairing', message: 'New pairing required' });
    } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
            const st = statusOf(number);
            if (st.isConnected) {
                return res.json({
                    status: 'already_connected',
                    message: 'Number is already connected and active',
                    connectionTime: st.connectionTime,
                    uptime: `${st.uptime} seconds`
                });
            }
            return res.json({ status: 'reconnecting', message: 'Attempting to reconnect with existing session data' });
        }
        res.json({ error: 'Failed to generate pairing code', details: err.message });
    }
});

app.get('/status', limit(120, 60 * 1000), (req, res, next) => {
    if (!req.query.number) return adminAuth(req, res, () => {
        const connections = [...manager.sessions.values()].filter(s => s.status === 'open').map(s => {
            const st = statusOf(s.number);
            return { number: s.number, status: 'connected', connectionTime: st.connectionTime, uptime: `${st.uptime} seconds` };
        });
        res.json({ totalActive: connections.length, connections });
    });
    const number = digits(req.query.number);
    const st = statusOf(number);
    res.json({
        number,
        isConnected: st.isConnected,
        connectionTime: st.connectionTime,
        uptime: `${st.uptime} seconds`,
        message: st.isConnected ? 'Number is actively connected' : 'Number is not connected'
    });
});

app.get('/disconnect', adminAuth, async (req, res) => {
    const number = digits(req.query.number);
    if (!number) return res.status(400).json({ error: 'Number parameter is required' });
    if (!sessionOf(number)) return res.status(404).json({ error: 'Number not found in active connections' });
    await manager.destroy(number, { wipe: true });
    console.log(`✅ Manually disconnected ${number}`);
    res.json({ status: 'success', message: 'Number disconnected successfully' });
});

app.get('/active', adminAuth, (req, res) => {
    const numbers = [...manager.sessions.values()].filter(s => s.status === 'open').map(s => s.number);
    res.json({ count: numbers.length, numbers });
});

app.get('/ping', (req, res) => {
    res.json({
        status: 'active',
        message: 'freezer is running',
        activeSessions: manager.stats().online,
        database: store.kind === 'postgres' ? 'PostgreSQL' : 'local files'
    });
});

app.get('/health', (req, res) => {
    res.json({ ok: true, storage: store.kind, uptimeSec: Math.floor((Date.now() - BOOT) / 1000), ...manager.stats(),
        rssMB: Math.round(process.memoryUsage().rss / 1048576) });
});

// Sessions are restored automatically at startup; this only restarts any that are not running.
app.get('/connect-all', adminAuth, async (req, res) => {
    await manager.restoreAll().catch(() => {});
    res.json({ status: 'success', total: manager.sessions.size });
});

// ---- change a user's settings from the web: an OTP is sent to THEIR OWN WhatsApp, then verified ----
const otps = new Map(); // number -> { otp, config, expires }
app.get('/update-config', limit(10, 10 * 60 * 1000), async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) return res.status(400).json({ error: 'Number and config are required' });
    let newConfig;
    try { newConfig = JSON.parse(configString); } catch { return res.status(400).json({ error: 'Invalid config format' }); }
    const n = digits(number);
    const s = sessionOf(n);
    if (!s || s.status !== 'open' || !s.sock) return res.status(404).json({ error: 'No active session found for this number' });
    const clean = userConfigLib.sanitize(newConfig);
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'No valid settings in config' });

    const otp = crypto.randomInt(100000, 1000000).toString();
    otps.set(n, { otp, config: clean, expires: Date.now() + 5 * 60000, tries: 0 });
    try {
        const jid = s.sock.user.id.split(':')[0] + '@s.whatsapp.net';
        await s.sock.sendMessage(jid, {
            text: `*🔐 CONFIGURATION UPDATE*\n\nYour OTP: *${otp}*\nValid for 5 minutes\n\nUse: /verify-otp ${otp}`
        });
        res.json({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        console.error('Failed to send OTP:', error.message);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

app.get('/verify-otp', limit(20, 10 * 60 * 1000), async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) return res.status(400).json({ error: 'Number and OTP are required' });
    const n = digits(number);
    const rec = otps.get(n);
    if (rec) rec.tries++;
    if (!rec || rec.expires < Date.now() || rec.tries > 5 || rec.otp !== String(otp)) {
        if (rec && (rec.expires < Date.now() || rec.tries > 5)) otps.delete(n);
        return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    otps.delete(n);
    const s = sessionOf(n);
    if (!s) return res.status(404).json({ error: 'No active session found for this number' });
    s.settings.userConfig = { ...(s.settings.userConfig || {}), ...rec.config };
    s.save();
    try {
        if (s.sock) await s.sock.sendMessage(s.sock.user.id.split(':')[0] + '@s.whatsapp.net', {
            text: `*✅ CONFIG UPDATED*\n\nYour configuration has been successfully updated!`
        });
    } catch { /* not important */ }
    res.json({ status: 'success', message: 'Config updated successfully' });
});

app.get('/stats', limit(60, 60 * 1000), (req, res) => {
    if (!req.query.number) return res.status(400).json({ error: 'Number is required' });
    const n = digits(req.query.number);
    const s = sessionOf(n);
    const st = statusOf(n);
    res.json({
        number: n,
        connectionStatus: st.isConnected ? 'Connected' : 'Disconnected',
        uptime: st.uptime,
        stats: s ? engine.getStats(s) : []
    });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if ((err.status || 500) >= 500) console.error('API error:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

// ---- boot ----
let server;
store.init().then(() => {
    server = app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT} (storage: ${store.kind})`);
        manager.startWatchdog();
        engine.startBackground(() => manager.sessions.values());
        manager.restoreAll().catch(err => console.error('restoreAll failed:', err));
    });
    server.on('error', err => { console.error('Server error:', err); process.exit(1); }); // pm2 restarts us
}).catch(err => {
    console.error(`❌ Storage init failed (${store.kind}): ${err.message}`);
    process.exit(1); // fail loudly: never silently fall back and lose users' sessions
});

const SELF = process.env.SELF_URL || process.env.RENDER_EXTERNAL_URL;
if (SELF) {
    const url = SELF.replace(/\/$/, '') + '/ping';
    setInterval(() => fetch(url).catch(() => {}), 4 * 60 * 1000).unref();
    console.log(`💓 Self-ping on ${url}`);
}

let closing = false;
async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`🛑 ${signal}: closing sockets (sessions are kept)`);
    await manager.shutdown();
    if (server) server.close(() => process.exit(0)); else process.exit(0);
    setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// The original restarted the whole server through pm2 on any uncaught error; here a single user's
// error must not take everyone down, so it is only logged.
process.on('uncaughtException', err => console.error('Uncaught exception:', err));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
