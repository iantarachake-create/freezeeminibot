'use strict';
// Per-user bot settings (the original kept these in MongoDB, "UserConfig"). Same fields and defaults.
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const defaults = () => ({
    AUTO_RECORDING: env('AUTO_RECORDING', 'false'),
    AUTO_TYPING: env('AUTO_TYPING', 'false'),
    ANTI_CALL: env('ANTI_CALL', 'false'),
    REJECT_MSG: env('REJECT_MSG', '*🔕 ʏᴏᴜʀ ᴄᴀʟʟ ᴡᴀs ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ʀᴇᴊᴇᴄᴛᴇᴅ..!*'),
    READ_MESSAGE: env('READ_MESSAGE', 'false'),
    AUTO_VIEW_STATUS: env('AUTO_VIEW_STATUS', 'true'),
    AUTO_LIKE_STATUS: env('AUTO_LIKE_STATUS', 'true'),
    AUTO_STATUS_REPLY: env('AUTO_STATUS_REPLY', 'false'),
    AUTO_STATUS_MSG: env('AUTO_STATUS_MSG', 'Hello from black freezer!'),
    AUTO_LIKE_EMOJI: ['❤️', '👍', '😮', '😎']
});

const BOOL = new Set(['AUTO_RECORDING', 'AUTO_TYPING', 'ANTI_CALL', 'READ_MESSAGE', 'AUTO_VIEW_STATUS', 'AUTO_LIKE_STATUS', 'AUTO_STATUS_REPLY']);

// The effective settings for one session: defaults + that user's own changes.
function get(session) {
    return { ...defaults(), ...(session?.settings?.userConfig || {}) };
}

// Only known fields with valid values are accepted (used by the /update-config + OTP flow).
function sanitize(input) {
    const out = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
    for (const k of Object.keys(defaults())) {
        if (!Object.prototype.hasOwnProperty.call(input, k)) continue;
        const v = input[k];
        if (BOOL.has(k)) { if (v === 'true' || v === 'false') out[k] = v; }
        else if (k === 'AUTO_LIKE_EMOJI') {
            if (Array.isArray(v) && v.length && v.length <= 30 && v.every(e => typeof e === 'string' && e.length <= 16)) out[k] = v;
        } else if (typeof v === 'string' && v.length <= 500) out[k] = v;
    }
    return out;
}

module.exports = { defaults, get, sanitize };
