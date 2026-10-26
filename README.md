# FREEZER MINIBOT

Multi-session WhatsApp mini bot. Users open your site, type their number, get a pairing code, link it —
their own bot is live. **No SESSION_ID, no per-user deploy.** Many numbers run in one process.

## Run
```bash
npm install
cp .env.example .env     # edit
npm start                # pm2-runtime, auto-restart. (npm run dev = plain node)
```
Open `http://localhost:8000` → pair page.

## Keeping sessions alive (important)
| Host | Do this |
|---|---|
| VPS / Pterodactyl / Railway volume | leave `MONGODB_URI` empty, `./sessions` is kept on disk. Use `npm start`. |
| Heroku / Render free / Koyeb (ephemeral disk) | set `MONGODB_URI` to **your own** Mongo (Atlas free works). Sessions auto-restore on every restart. |
| Sleeping free hosts | set `APP_URL` to your public URL (self-ping every 4 min) and/or ping `/health` with UptimeRobot |

Run **one** instance only. Two processes with the same sessions will kick each other (440 "replaced").

## What makes it stable
- creds **and** signal keys are persisted (old version saved creds only)
- unlimited reconnects, exponential backoff + jitter; 515 reconnects instantly
- 30s watchdog revives stuck/dead sockets
- session deleted only when WhatsApp reports logged-out (user unlinked the device)
- graceful SIGTERM keeps sessions; crashes in one plugin/socket don't affect others
- per-session settings, caches and owner — `.settings`, `.logout`, `.reboot` only affect the sender's own bot

## Endpoints
`GET /api/pair?number=` · `GET /api/status?number=` · `GET /api/stats` · `GET /health`
Admin (needs `ADMIN_KEY`, header `x-admin-key`): `/api/admin/sessions`, `/api/admin/disconnect?number=`, `/api/admin/restart?number=`

## User commands
`.menu` `.settings` `.settings antidelete on` `.settings mode private` `.reboot` `.logout confirm` `.botstats`
