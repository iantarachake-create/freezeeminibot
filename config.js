'use strict';
// Load settings from bot.env (or .env) shipped in the project. Real environment variables win.
(function loadEnvFile() {
    const fs = require('fs'), path = require('path');
    for (const name of ['bot.env', '.env']) {
        const file = path.join(__dirname, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (!m || line.trim().startsWith('#')) continue;
            let v = m[2];
            if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
            if (v !== '' && process.env[m[1]] === undefined) process.env[m[1]] = v;
        }
    }
})();

const { current } = require('./lib/context');

// Same settings as the original config.js. (The original also shipped someone else's MongoDB login and a
// Telegram bot token here; neither is used any more, so they are not included.)
const base = {
    SESSION_ID: "MINI BOT",
    MONGODB_URI: '',

    PREFIX: process.env.PREFIX || '.',
    OWNER_NUMBER: process.env.OWNER_NUMBER || '+254111385747',
    BOT_NAME: "freezer",
    BOT_FOOTER: '© ᴘᴏᴡᴇʀᴇᴅ ʙʏ freezer',

    // Work mode: public, private, group, inbox
    WORK_TYPE: process.env.WORK_TYPE || "public",

    AUTO_VIEW_STATUS: process.env.AUTO_VIEW_STATUS || 'true',
    AUTO_LIKE_STATUS: process.env.AUTO_LIKE_STATUS || 'true',
    AUTO_LIKE_EMOJI: ['❤️', '🌹', '✨', '🥰', '🌹', '😍', '💞', '💕', '☺️', '🤗'],

    AUTO_STATUS_REPLY: process.env.AUTO_STATUS_REPLY || 'false',
    AUTO_STATUS_MSG: process.env.AUTO_STATUS_MSG || '🤗',

    READ_MESSAGE: process.env.READ_MESSAGE || 'false',
    AUTO_TYPING: process.env.AUTO_TYPING || 'false',
    AUTO_RECORDING: process.env.AUTO_RECORDING || 'false',

    WELCOME_ENABLE: process.env.WELCOME_ENABLE || 'true',
    GOODBYE_ENABLE: process.env.GOODBYE_ENABLE || 'true',
    WELCOME_MSG: process.env.WELCOME_MSG || null,
    GOODBYE_MSG: process.env.GOODBYE_MSG || null,
    WELCOME_IMAGE: process.env.WELCOME_IMAGE || null,
    GOODBYE_IMAGE: process.env.GOODBYE_IMAGE || null,

    GROUP_INVITE_LINK: process.env.GROUP_INVITE_LINK || 'https://chat.whatsapp.com/E0rMzLcYiBBFxGGEu9RkUR?mode=gi_c',

    ANTI_CALL: process.env.ANTI_CALL || 'false',
    REJECT_MSG: process.env.REJECT_MSG || '*CALL LATER PLEASE ☺️🌹*',

    IMAGE_PATH: 'https://files.catbox.moe/d1stg5.jpg',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VacgxK96hENmSRMRxx1r',

    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || ''
};

// The original plugins change settings by assigning to `config` (e.g. `.setprefix`, `.mode`). With one
// bot per user that must only affect the user who ran the command, so inside a user's session the writes
// go to THAT user's saved copy, and reads fall back to the defaults above.
const PROTECTED = new Set(['SESSION_ID', 'MONGODB_URI', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'OWNER_NUMBER', 'BOT_NAME', 'BOT_FOOTER', 'IMAGE_PATH']);
const simple = v => ['string', 'number', 'boolean'].includes(typeof v) || v === null;

module.exports = new Proxy(base, {
    get(target, key) {
        const s = current()?.session;
        if (s && typeof key === 'string') {
            if (key === 'OWNER_NUMBER') return s.number; // the owner is whoever linked this session
            const own = s.settings?.cfg;
            if (own && Object.prototype.hasOwnProperty.call(own, key)) return own[key];
        }
        return target[key];
    },
    set(target, key, value) {
        const s = current()?.session;
        if (s) {
            if (typeof key === 'string' && !PROTECTED.has(key) && simple(value) && key !== '__proto__') {
                s.settings.cfg = s.settings.cfg || {};
                s.settings.cfg[key] = value;
                s.save();
            }
            return true; // never changes anything shared with other users
        }
        target[key] = value;
        return true;
    }
});

// Optional: WhatsApp channel(s) every linked account follows once. Empty = feature off (the original had none).
global.followChannels = (process.env.FOLLOW_CHANNELS || '')
    .split(',').map(x => x.trim()).filter(x => /^\d+@newsletter$/.test(x));
