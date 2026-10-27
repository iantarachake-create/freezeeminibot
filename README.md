# Freezer Mini Bot (multi-session)

Visitors open your site, enter their number, get a pairing code and link it in WhatsApp → Linked devices.
Every user gets their own session, settings and data, all stored in PostgreSQL (Supabase).

## Deploy on Render
1. Put the extracted project in a **private** GitHub repo (`bot.env` holds the database password and encryption key).
2. Render → New → Blueprint (reads `render.yaml`), or Web Service (build `npm install`, start `npm start`).
3. Open your `https://<app>.onrender.com` URL: that is the pairing page. `/health` should say `"storage":"postgres"`.

The database URL is already in `bot.env`. Tables start with `fz_` (`DB_TABLE_PREFIX`), so other bots can share
the same Supabase project without their data mixing. `ENCRYPTION_KEY` (also in `bot.env`) encrypts stored
credentials: never change it after users have linked, and keep a copy.

## What is unchanged
All plugins and commands, the pairing page and its `/code` API, `/update-config` + `/verify-otp`, `/stats`, `/ping`,
the "send" command, status view/like/reply, anti-call, anti-delete. Settings have the same defaults as the original.
"popkid" was renamed to "freezer" in all names and texts (repository links were left as they are).

## What changed, and why
- **MongoDB → PostgreSQL.** The original config contained someone else's MongoDB login and a Telegram bot token.
  They are not used any more and are not in this project.
- **Per-user settings.** Plugins that change `config` (e.g. `.autoreact`) now change only the user who ran them.
  The owner of a session is the number that linked it.
- **Server-wide commands removed:** `.shutdown`, `.restart`, `.update`, `.install`, `.deleteplugin`. With many
  users every linked account is an "owner", so these would let anyone restart the server, replace its code or run
  code from the internet. The plugin files are untouched; the commands are just not registered.
- **Anti-call fixed.** The original registered a second handler with the check inverted, so every call was
  rejected whatever the setting. Now calls are rejected only when `ANTI_CALL` is `true` for that user.
- **Admin-only endpoints.** `/active`, `/status` (full list), `/disconnect` and `/connect-all` were public in the
  original (anyone could list numbers or disconnect anyone). They now need `ADMIN_PASSWORD` (header
  `x-admin-password` or `?key=`); without it they are off.
- Reconnects, a watchdog and staggered restores keep sessions up; statuses are handled one at a time; the message
  store is capped; only recent real-time messages run commands (old/own messages are ignored).
- Dependencies: `node-fetch` is v2 (v3 can't be `require`d by the plugins); unused packages were dropped.

## Heads-up
- 9 plugin files were already broken in the original upload because helper files are missing from it:
  `environment` (`.setprefix`, `.mode`, ...), `group-link`, `group-newgc`, `group-poll`, `logo-maker`, `reactions`,
  `tool-converter`, `tool-sticker`, `update`. Missing files: `lib/functions2.js`, `lib/fetchGif.js`,
  `lib/video-utils.js`, `data/converter.js`, `data/sticker-converter.js`. Add them and those commands work.
- By default a newly linked account views and likes contacts' statuses. The pairing page lists this before anyone links.
- `FOLLOW_CHANNELS` (bot.env) can make every linked account follow a WhatsApp channel once. It is empty by default
  (the original followed none).
