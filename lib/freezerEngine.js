'use strict';
/**
 * Per-session port of the original popkid.js (now freezer): same behaviour, same plugins, but every linked
 * WhatsApp account has its own settings and data. Handlers run inside an AsyncLocalStorage context so the
 * unchanged plugins' `config` reads/writes resolve to the right user.
 *
 * Differences from the original (on purpose):
 *  - settings/data live in the database per user instead of one shared MongoDB
 *  - the second, inverted anti-call handler is gone (it rejected EVERY call whatever the setting was)
 *  - statuses are handled one at a time (~1s apart); group info is cached; the message store is capped
 */
const { getContentType, jidNormalizedUser, jidDecode, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const events = require('../command');
const userConfigLib = require('./userConfig');
const { sms } = require('./msg');
const { handleAntidelete } = require('./antidelete');
const { createStore } = require('./msgStore');
const { run } = require('./context');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const createSerial = (size) => crypto.randomBytes(size).toString('hex').slice(0, size);

const getGroupAdmins = (participants) => {
    let admins = [];
    for (let i of participants) {
        if (i.admin == null) continue;
        admins.push(i.id);
    }
    return admins;
};

// ---------------------------------------------------------------- statistics (per user, saved once a minute)
function stats(session) {
    if (!session.stats) {
        try { session.stats = JSON.parse(session.docs['stats.json'] || '{}'); } catch { session.stats = {}; }
    }
    return session.stats;
}
function incrementStats(session, field) {
    const today = new Date().toISOString().split('T')[0];
    const st = stats(session);
    st[today] = st[today] || { commandsUsed: 0, messagesReceived: 0, messagesSent: 0, groupsInteracted: 0 };
    st[today][field] = (st[today][field] || 0) + 1;
    session.statsDirty = true;
}
function getStats(session) {
    return Object.entries(stats(session)).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 30)
        .map(([date, v]) => ({ date, ...v }));
}

// ---------------------------------------------------------------- status view / like / reply
const lidCache = new Map();
async function resolveStatusJid(conn, mek) {
    const p = mek.key.participant || mek.participant;
    if (!p) return null;
    if (!p.endsWith('@lid')) return p;
    const lid = p.split('@')[0].split(':')[0];
    if (lidCache.has(lid)) return `${lidCache.get(lid)}@s.whatsapp.net`;
    const rawPn = mek.key?.participantPn || mek.key?.senderPn || mek.participantPn;
    if (rawPn) {
        const num = String(rawPn).split('@')[0].split(':')[0];
        lidCache.set(lid, num);
        return `${num}@s.whatsapp.net`;
    }
    try {
        const r = await conn.signalRepository?.lidMapping?.getPNForLID?.(p);
        const num = r ? String(r).split('@')[0].split(':')[0].replace(/\D/g, '') : '';
        if (num.length >= 7) {
            if (lidCache.size > 5000) lidCache.clear();
            lidCache.set(lid, num);
            return `${num}@s.whatsapp.net`;
        }
    } catch { /* fall through */ }
    return p;
}

async function handleStatus(conn, session, mek) {
    const userConfig = userConfigLib.get(session);
    const participant = await resolveStatusJid(conn, mek);
    if (!participant) return;
    const key = { ...mek.key, participant };

    // Auto View
    if (userConfig.AUTO_VIEW_STATUS === "true") await conn.readMessages([key]);

    // Auto Like
    if (userConfig.AUTO_LIKE_STATUS === "true") {
        const jawadlike = await conn.decodeJid(conn.user.id);
        const emojis = userConfig.AUTO_LIKE_EMOJI || config.AUTO_LIKE_EMOJI;
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        await conn.sendMessage(mek.key.remoteJid, {
            react: { text: randomEmoji, key }
        }, { statusJidList: [participant, jawadlike] });
    }

    // Auto Reply
    if (userConfig.AUTO_STATUS_REPLY === "true") {
        const text = userConfig.AUTO_STATUS_MSG || config.AUTO_STATUS_MSG;
        await conn.sendMessage(participant, {
            text: text,
            react: { text: '💞', key }
        }, { quoted: mek });
    }
}

// One status at a time, ~1s apart: a burst (e.g. right after reconnecting) can't flood the account or the server.
function queueStatus(conn, session, ctx, mek) {
    session.statusPending = (session.statusPending || 0) + 1;
    if (session.statusPending > 300) { session.statusPending--; return; }
    session.statusQueue = (session.statusQueue || Promise.resolve()).then(async () => {
        try {
            if (session.sock === conn) await run(ctx, () => handleStatus(conn, session, mek));
        } catch (e) {
            console.error(`[status] ${e.message}`);
        } finally {
            session.statusPending--;
        }
        await sleep(1000);
    }).catch(() => {});
}

// ---------------------------------------------------------------- the main message handler (original logic)
async function handleMessage(conn, session, ctx, mek) {
    const number = session.number;
    const sanitizedNumber = number;
    try {
        if (!mek.message) return;
        const userConfig = userConfigLib.get(session);

        // (original handler #1) presence for every incoming message
        if (mek.key.remoteJid !== 'status@broadcast') {
            if (userConfig.AUTO_TYPING === 'true') {
                try { await conn.sendPresenceUpdate('composing', mek.key.remoteJid); } catch (error) { console.error(`Failed to set typing presence:`, error.message); }
            }
            if (userConfig.AUTO_RECORDING === 'true') {
                try { await conn.sendPresenceUpdate('recording', mek.key.remoteJid); } catch (error) { console.error(`Failed to set recording presence:`, error.message); }
            }
        }

        // Normalize Message
        mek.message = (getContentType(mek.message) === 'ephemeralMessage')
            ? mek.message.ephemeralMessage.message
            : mek.message;

        if (mek.message.viewOnceMessageV2) {
            mek.message = (getContentType(mek.message) === 'ephemeralMessage')
                ? mek.message.ephemeralMessage.message
                : mek.message;
        }

        // Auto Read basé sur config
        if (userConfig.READ_MESSAGE === 'true') {
            await conn.readMessages([mek.key]);
        }

        // Newsletter Reaction
        const newsletterJids = ["120363289379419860@newslette"];
        const newsEmojis = ["❤️", "👍", "😮", "😎", "💀", "💫", "🔥", "👑"];
        if (mek.key && newsletterJids.includes(mek.key.remoteJid)) {
            try {
                const serverId = mek.newsletterServerId;
                if (serverId) {
                    const emoji = newsEmojis[Math.floor(Math.random() * newsEmojis.length)];
                    await conn.newsletterReactMessage(mek.key.remoteJid, serverId.toString(), emoji);
                }
            } catch (e) {}
        }

        // Status Handling
        if (mek.key && mek.key.remoteJid === 'status@broadcast') {
            if (!mek.key.fromMe) queueStatus(conn, session, ctx, mek);
            return;
        }
        if (mek.key.remoteJid.endsWith('@newsletter') || mek.key.remoteJid === 'broadcast') return;

        // Message Serialization
        const m = sms(conn, mek);
        const type = getContentType(mek.message);
        const from = mek.key.remoteJid;
        const quoted = type == 'extendedTextMessage' && mek.message.extendedTextMessage.contextInfo != null ? mek.message.extendedTextMessage.contextInfo.quotedMessage || [] : [];
        const body = (type === 'conversation') ? mek.message.conversation : (type === 'extendedTextMessage') ? mek.message.extendedTextMessage.text : '';

        const isCmd = body.startsWith(config.PREFIX);
        const command = isCmd ? body.slice(config.PREFIX.length).trim().split(' ').shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const q = args.join(' ');
        const text = q;
        const isGroup = from.endsWith('@g.us');

        const sender = mek.key.fromMe ? (conn.user.id.split(':')[0] + '@s.whatsapp.net' || conn.user.id) : (mek.key.participant || mek.key.remoteJid);
        const senderNumber = sender.split('@')[0];
        const botNumber = conn.user.id.split(':')[0];
        const botNumber2 = await jidNormalizedUser(conn.user.id);
        const pushname = mek.pushName || 'User';

        const isMe = botNumber.includes(senderNumber);
        const isOwner = config.OWNER_NUMBER.includes(senderNumber) || isMe;
        const isCreator = isOwner;

        // Group Metadata
        let groupMetadata = null;
        let groupName = null;
        let participants = null;
        let groupAdmins = null;
        let isBotAdmins = null;
        let isAdmins = null;

        if (isGroup) {
            try {
                groupMetadata = await (conn.getGroupMeta ? conn.getGroupMeta(from) : conn.groupMetadata(from));
                groupName = groupMetadata.subject;
                participants = await groupMetadata.participants;
                groupAdmins = await getGroupAdmins(participants);
                isBotAdmins = groupAdmins.includes(botNumber2);
                isAdmins = groupAdmins.includes(sender);
            } catch (e) {}
        }

        // Auto Presence
        if (userConfig.AUTO_TYPING === 'true') await conn.sendPresenceUpdate('composing', from);
        if (userConfig.AUTO_RECORDING === 'true') await conn.sendPresenceUpdate('recording', from);

        // Custom MyQuoted
        const myquoted = {
                key: {
                    remoteJid: 'status@broadcast',
                    participant: '13135550002@s.whatsapp.net',
                    fromMe: false,
                    id: createSerial(16).toUpperCase()
                },
                message: {
                    contactMessage: {
                        displayName: "© FREEZER",
                        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:FREEZER\nORG:FREEZER;\nTEL;type=CELL;type=VOICE;waid=13135550002:13135550002\nEND:VCARD`,
                        contextInfo: {
                            stanzaId: createSerial(16).toUpperCase(),
                            participant: "0@s.whatsapp.net",
                            quotedMessage: { conversation: "© Freezer" }
                        }
                    }
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                status: 1,
                verifiedBizName: "Meta"
            };

        const reply = (text) => conn.sendMessage(from, { text: text }, { quoted: myquoted });
        const l = reply;

        // "Send" Command
        const cmdNoPrefix = body.toLowerCase().trim();
        if (["send", "sendme", "sand"].includes(cmdNoPrefix)) {
            if (!mek.message.extendedTextMessage?.contextInfo?.quotedMessage) {
                await conn.sendMessage(from, { text: "*STATUS VIEWED😁*" }, { quoted: mek });
            } else {
                try {
                    let qMsg = mek.message.extendedTextMessage.contextInfo.quotedMessage;
                    let mtype = Object.keys(qMsg)[0];
                    const stream = await downloadContentFromMessage(qMsg[mtype], mtype.replace('Message', ''));
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    let content = {};
                    if (mtype === 'imageMessage') content = { image: buffer, caption: qMsg[mtype].caption };
                    else if (mtype === 'videoMessage') content = { video: buffer, caption: qMsg[mtype].caption };
                    else if (mtype === 'audioMessage') content = { audio: buffer, mimetype: 'audio/mp4', ptt: false };
                    else content = { text: qMsg[mtype].text || qMsg.conversation };

                    if (content) await conn.sendMessage(from, content, { quoted: mek });
                } catch (e) { console.error(e); }
            }
        }

        // Execute Plugins
        const cmdName = isCmd ? body.slice(config.PREFIX.length).trim().split(" ")[0].toLowerCase() : false;
        if (isCmd) {
            incrementStats(session, 'commandsUsed');

            const cmd = events.commands.find((cmd) => cmd.pattern === (cmdName)) || events.commands.find((cmd) => cmd.alias && cmd.alias.includes(cmdName));
            if (cmd) {
                if (config.WORK_TYPE === 'private' && !isOwner) return;
                if (cmd.react) conn.sendMessage(from, { react: { text: cmd.react, key: mek.key } });

                try {
                    // Not awaited (as in the original) so a slow command never blocks the next message
                    Promise.resolve(cmd.function(conn, mek, m, {
                        from, quoted: mek, body, isCmd, command, args, q, text, isGroup, sender,
                        senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator,
                        groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins,
                        reply, config, myquoted
                    })).catch(e => console.error("[PLUGIN ERROR] " + e));
                } catch (e) {
                    console.error("[PLUGIN ERROR] " + e);
                }
            }
        }

        // Statistiques messages
        incrementStats(session, 'messagesReceived');
        if (isGroup) incrementStats(session, 'groupsInteracted');

        // Execute Events
        events.commands.map(async (command) => {
            const ctx2 = { from, l, quoted: mek, body, isCmd, command, args, q, text, isGroup, sender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, isCreator, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply, config, myquoted };

            if (body && command.on === "body") command.function(conn, mek, m, ctx2);
            else if (mek.q && command.on === "text") command.function(conn, mek, m, ctx2);
            else if ((command.on === "image" || command.on === "photo") && mek.type === "imageMessage") command.function(conn, mek, m, ctx2);
            else if (command.on === "sticker" && mek.type === "stickerMessage") command.function(conn, mek, m, ctx2);
        });

    } catch (e) {
        console.error(e);
    }
}

// ---------------------------------------------------------------- wiring for one socket
function attach(conn, session) {
    session.store = createStore();
    session.store.bind(conn.ev);

    // UTILS ATTACHED TO CONN (as in the original)
    conn.decodeJid = jid => {
        if (!jid) return jid;
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {};
            return (decode.user && decode.server && decode.user + '@' + decode.server) || jid;
        } else return jid;
    };

    conn.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg ? message.msg : message;
        let mime = (message.msg || message).mimetype || '';
        let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0];
        const stream = await downloadContentFromMessage(quoted, messageType);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        const { fileTypeFromBuffer } = await import('file-type'); // file-type is ESM-only
        let type = await fileTypeFromBuffer(buffer);
        let trueFileName = attachExtension ? (filename + '.' + type.ext) : filename;
        await fs.writeFileSync(trueFileName, buffer);
        return trueFileName;
    };

    // Real-time messages are always handled. "append" is history / our own sent messages / offline backlog:
    // only recent messages from other people are handled, so old commands are not replayed after a restart
    // and the bot never answers its own replies.
    conn.ev.on('messages.upsert', ({ messages, type }) => {
        if (session.sock !== conn) return;
        for (const mek of messages) {
            if (!mek?.message || !mek.key?.remoteJid) continue;
            if (type !== 'notify') {
                const ts = Number(mek.messageTimestamp?.low ?? mek.messageTimestamp ?? 0);
                if (mek.key.fromMe || !ts || Date.now() / 1000 - ts > 30) continue;
            }
            const ctx = { session, conn, mek };
            run(ctx, () => handleMessage(conn, session, ctx, mek)).catch(() => {});
        }
    });

    // ANTI-CALL (the original registered a second handler with the check inverted, which rejected every call)
    conn.ev.on('call', calls => {
        if (session.sock !== conn) return;
        run({ session, conn }, async () => {
            try {
                const userConfig = userConfigLib.get(session);
                if (userConfig.ANTI_CALL !== 'true') return;
                for (const call of calls) {
                    if (call.status !== 'offer') continue;
                    await conn.rejectCall(call.id, call.from);
                    await conn.sendMessage(call.from, {
                        text: userConfig.REJECT_MSG || '*CALL NAHI KARE PLEASE ☺️*'
                    });
                    console.log(`CALL REJECT ${session.tag}`);
                }
            } catch (err) {
                console.error(`Anti-call error for ${session.tag}:`, err.message);
            }
        }).catch(() => {});
    });

    // ANTIDELETE
    conn.ev.on('messages.update', updates => {
        if (session.sock !== conn) return;
        run({ session, conn }, () => handleAntidelete(conn, updates, session.store)).catch(() => {});
    });
}

// ---------------------------------------------------------------- when a session connects
async function onOpen(session, conn, firstTime) {
    await run({ session, conn }, async () => {
        if (!firstTime) return;
        const userJid = jidNormalizedUser(conn.user.id);
        const connectText = `
               ╔════════════════╗

║ 🤖 CONNECTED
╠════════════════╣
║ 🔑 PREFIX  : ${config.PREFIX}
║ 👨‍💻 DEV     : FREEZER-MD
║ 📞 DEV NO : 254732297194
╚════════════════╝

               
               `;
        await conn.sendMessage(userJid, {
            image: { url: config.IMAGE_PATH },
            caption: connectText
        }).catch(() => {});
    });
}

// Statistics are written to the database once a minute (not on every message)
function startBackground(getSessions) {
    const timer = setInterval(() => {
        for (const s of getSessions()) {
            if (!s.statsDirty) continue;
            s.statsDirty = false;
            s.docs['stats.json'] = JSON.stringify(s.stats || {});
            s.markDoc('stats.json');
        }
    }, 60000);
    timer.unref?.();
    return timer;
}

function flushStats(session) {
    if (session.statsDirty) {
        session.statsDirty = false;
        session.docs['stats.json'] = JSON.stringify(session.stats || {});
        session.markDoc('stats.json');
    }
}

module.exports = { attach, onOpen, startBackground, flushStats, getStats };
