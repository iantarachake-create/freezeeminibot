const fs = require('fs');
try { if (fs.existsSync('.env')) require('dotenv').config({ path: '.env' }); } catch (_) {}

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const bool = (k, d) => String(env(k, d));

module.exports = {
  // ---- server / storage ----
  PORT: Number(env('PORT', 8000)),
  DATABASE_URL: env('DATABASE_URL', ''),    // PostgreSQL (Supabase). takes priority over MONGODB_URI
  MONGODB_URI: env('MONGODB_URI', ''),      // optional, YOUR OWN db. empty => disk storage
  SESSIONS_DIR: env('SESSIONS_DIR', './sessions'),
  MAX_SESSIONS: Number(env('MAX_SESSIONS', 50)),
  ADMIN_KEY: env('ADMIN_KEY', ''),
  APP_URL: env('APP_URL', env('RENDER_EXTERNAL_URL', '')),

  // ---- bot identity ----
  PREFIX: env('PREFIX', '.'),
  OWNER_NUMBER: env('OWNER_NUMBER', '254732297194'),
  OWNER_NAME: env('OWNER_NAME', 'Freezer'),
  BOT_NAME: env('BOT_NAME', 'freezer minibot'),
  BOT_FOOTER: env('BOT_FOOTER', '© ᴘᴏᴡᴇʀᴇᴅ ʙʏ freezer'),
  DEV: env('DEV', '254732297194'),
  DESCRIPTION: env('DESCRIPTION', 'freezer minibot'),
  WORK_TYPE: env('WORK_TYPE', 'public'),     // public | private (private = only the session owner)
  MODE: env('WORK_TYPE', 'public'),
  PUBLIC_MODE: bool('PUBLIC_MODE', 'true'),

  // ---- defaults for NEW sessions (each user can change theirs with .settings) ----
  DEFAULTS: {
    AUTO_VIEW_STATUS: bool('AUTO_VIEW_STATUS', 'true'),
    AUTO_LIKE_STATUS: bool('AUTO_LIKE_STATUS', 'true'),
    AUTO_STATUS_REPLY: bool('AUTO_STATUS_REPLY', 'false'),
    READ_MESSAGE: bool('READ_MESSAGE', 'false'),
    AUTO_TYPING: bool('AUTO_TYPING', 'false'),
    AUTO_RECORDING: bool('AUTO_RECORDING', 'false'),
    ALWAYS_ONLINE: bool('ALWAYS_ONLINE', 'false'),
    ANTI_CALL: bool('ANTI_CALL', 'false'),
    ANTI_DELETE: bool('ANTI_DELETE', 'false'),
    WELCOME_ENABLE: bool('WELCOME_ENABLE', 'false'),
    GOODBYE_ENABLE: bool('GOODBYE_ENABLE', 'false')
  },
  AUTO_LIKE_EMOJI: ['❤️', '🌹', '✨', '🥰', '😍', '💞', '💕', '☺️', '🤗', '🔥', '👑'],
  AUTO_STATUS_MSG: env('AUTO_STATUS_MSG', '🤗'),
  REJECT_MSG: env('REJECT_MSG', '*🔕 Calls are not accepted on this number.*'),

  // ---- legacy flags the plugins read (global) ----
  WELCOME_ENABLE: 'false', GOODBYE_ENABLE: 'false',
  WELCOME_MSG: null, GOODBYE_MSG: null, WELCOME_IMAGE: null, GOODBYE_IMAGE: null,
  AUTO_REACT: bool('AUTO_REACT', 'false'),
  AUTO_REPLY: bool('AUTO_REPLY', 'false'),
  AUTO_STICKER: bool('AUTO_STICKER', 'false'),
  ANTI_LINK: bool('ANTI_LINK', 'false'),
  ANTI_LINK_MODE: env('ANTI_LINK_MODE', 'warn'),
  ANTI_LINK_KICK: bool('ANTI_LINK_KICK', 'false'),
  DELETE_LINKS: bool('DELETE_LINKS', 'false'),
  ANTI_BAD_WORD: bool('ANTI_BAD_WORD', 'false'),
  ANTI_VV: bool('ANTI_VV', 'false'),
  MENTION_REPLY: bool('MENTION_REPLY', 'false'),
  ADMIN_EVENTS: bool('ADMIN_EVENTS', 'false'),
  STICKER_NAME: env('STICKER_NAME', 'freezer'),

  // ---- images / links ----
  IMAGE_PATH: env('IMAGE_PATH', 'https://files.catbox.moe/d1stg5.jpg'),
  MENU_IMAGE_URL: env('MENU_IMAGE_URL', 'https://files.catbox.moe/d1stg5.jpg'),
  ALIVE_IMG: env('ALIVE_IMG', 'https://files.catbox.moe/d1stg5.jpg'),
  CHANNEL_LINK: env('CHANNEL_LINK', 'https://whatsapp.com/channel/0029VacgxK96hENmSRMRxx1r'),
  GROUP_INVITE_LINK: env('GROUP_INVITE_LINK', '')
};
