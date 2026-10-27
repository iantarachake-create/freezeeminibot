'use strict';
// .play <song name | YouTube link>  ->  menu card, reply 1 (audio) / 2 (document) / 3 (voice note)
// MP3 comes from the delirius ytmp3 API. Works per session (many linked users) and needs no changes elsewhere:
// a plugin with pattern "play" wins over the old "play" alias in video.js.
const axios = require('axios');
const yts = require('yt-search');
const { cmd } = require('../command');

const YTMP3_API = 'https://api.delirius.online/download/ytmp3';
const YT_ID_REGEX = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:\S*&)?v=|shorts\/|embed\/|v\/|live\/))([\w-]{11})/i;
const MAX_SECONDS = 30 * 60;          // refuse anything longer than 30 minutes
const MAX_BYTES = 100 * 1024 * 1024;  // 100MB download cap
const PENDING_TTL = 10 * 60 * 1000;   // menu stays active for 10 minutes
const MAX_PENDING = 500;

const TITLE = '┏▣ ◈ *𝗙𝗥𝗘𝗘𝗭𝗘𝗥 𝗠𝗗* ◈';
const TAGLINE = '┃📌 FREEZER-MD • Music Center';
const FOOTER = '> © 𝗙𝗥𝗘𝗘𝗭𝗘𝗥-𝗠𝗗 🥶';

// menu card message id -> { session, chat, sender, videoUrl, title, expires }
const pending = new Map();
const handled = new Set(); // reply ids already processed

const wait = ms => new Promise(r => setTimeout(r, ms));

const box = (heading, ...lines) => [
    TITLE,
    '┃',
    `┃┌─ ${heading} ───`,
    ...lines.filter(l => l !== null && l !== undefined).map(l => (l === '' ? '┃│' : `┃│ ${l}`)),
    '┃└─────────────',
    '┃',
    TAGLINE,
    '┃',
    '┗▣',
    FOOTER
].join('\n');

const clean = s => String(s || 'song').replace(/[<>:"/\\|?*\n\r]/g, '_').trim().slice(0, 100);

function sweep() {
    const now = Date.now();
    for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
    while (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);
    if (handled.size > 500) handled.clear();
}

// "1" / "audio" / "doc" / "vn" ... -> 'audio' | 'document' | 'voice' | null
function parseChoice(text) {
    const t = String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (['1', 'audio', 'mp3', 'song', 'music'].includes(t)) return 'audio';
    if (['2', 'doc', 'document', 'file'].includes(t)) return 'document';
    if (['3', 'vn', 'voice', 'voicenote', 'ptt'].includes(t)) return 'voice';
    return null;
}

async function resolveVideo(query) {
    const id = query.match(YT_ID_REGEX)?.[1];
    if (id) {
        try {
            const v = await yts({ videoId: id });
            if (v?.videoId) return v;
        } catch { /* metadata is best-effort for links */ }
        return { videoId: id, url: `https://www.youtube.com/watch?v=${id}` };
    }
    const res = await yts(query);
    const v = res?.videos?.[0];
    if (!v) throw new Error(`No song found for: ${query}`);
    return v;
}

async function fetchMp3(videoUrl, retries = 2) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const { data } = await axios.get(YTMP3_API, { params: { url: videoUrl }, timeout: 90000 });
            const link = data?.data?.download;
            if (!data?.status || !link || !/^https?:\/\//i.test(link)) {
                throw new Error('Download link not available for this video');
            }
            return data.data;
        } catch (err) {
            lastErr = err;
            if (i < retries) await wait(3000);
        }
    }
    throw lastErr;
}

async function getBuffer(url) {
    const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 180000,
        maxContentLength: MAX_BYTES,
        maxBodyLength: MAX_BYTES,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' }
    });
    return Buffer.from(res.data);
}

// mp3 buffer -> ogg/opus buffer (what WhatsApp voice notes need), using the bot's ffmpeg helper
function toVoiceNote(mp3Buffer) {
    const { run } = require('../lib/ffmpeg-run');
    return run(mp3Buffer, 'mp3', 'ogg', c =>
        c.noVideo().audioCodec('libopus').audioBitrate('64k').audioFrequency(48000).audioChannels(1).format('ogg'));
}

async function deliver(conn, from, mek, choice, mp3, title) {
    const opts = { quoted: mek };
    const fileName = `${clean(title)}.mp3`;

    if (choice === 'voice') {
        const mp3Buffer = await getBuffer(mp3.download);
        try {
            const ogg = await toVoiceNote(mp3Buffer);
            return await conn.sendMessage(from, { audio: ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }, opts);
        } catch (err) {
            console.error('[PLAY] voice conversion failed, sending mp3 as PTT:', err.message);
            return await conn.sendMessage(from, { audio: mp3Buffer, mimetype: 'audio/mpeg', ptt: true }, opts);
        }
    }

    const key = choice === 'document' ? 'document' : 'audio';
    const content = choice === 'document'
        ? { mimetype: 'audio/mpeg', fileName, caption: `🎵 ${title}\n\n${FOOTER}` }
        : { mimetype: 'audio/mpeg', fileName };
    try {
        // fast path: WhatsApp pulls straight from the URL
        return await conn.sendMessage(from, { ...content, [key]: { url: mp3.download } }, opts);
    } catch {
        // fallback: download first, then upload
        const buffer = await getBuffer(mp3.download);
        return await conn.sendMessage(from, { ...content, [key]: buffer }, opts);
    }
}

// ---------------------------------------------------------------- .play
cmd({
    pattern: 'play',
    alias: ['ply', 'playy', 'pl'],
    desc: 'Search YouTube and get a song as audio, document or voice note',
    category: 'main',
    filename: __filename
}, async (conn, mek, m, { from, args, q, sender, reply, config }) => {
    const react = emoji => conn.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});
    const prefix = config.PREFIX || '.';
    const query = (q || m.quoted?.body || '').trim();

    if (!query) {
        return reply(box(
            '🎵 *𝗠𝗨𝗦𝗜𝗖 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥*',
            '➤ Enter a song name or YouTube link.',
            '',
            '📌 *𝗘𝗫𝗔𝗠𝗣𝗟𝗘𝗦*',
            `➤ ${prefix}play harlem shake`,
            `➤ ${prefix}play https://youtu.be/dQw4w9WgXcQ`
        ));
    }
    if (query.length > 150) return reply(box('❌ *𝗜𝗡𝗩𝗔𝗟𝗜𝗗 𝗤𝗨𝗘𝗥𝗬*', '➤ Keep it under 150 characters.'));

    try {
        await react('⌛');
        const video = await resolveVideo(query);
        const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.videoId}`;

        if (video.seconds && video.seconds > MAX_SECONDS) {
            await react('❌');
            return reply(box(
                '❌ *𝗧𝗢𝗢 𝗟𝗢𝗡𝗚*',
                `➤ ${video.title || 'This video'} is ${video.timestamp}.`,
                `➤ Max allowed is ${MAX_SECONDS / 60} minutes.`
            ));
        }

        const title = video.title || 'Unknown Song';
        const thumbnail = video.thumbnail || video.image || '';
        const caption = box(
            '🎵 *𝗦𝗢𝗡𝗚*',
            `➤ ${title}`,
            video.author?.name ? `➤ 👤 ${video.author.name}` : null,
            video.timestamp ? `➤ ⏱️ ${video.timestamp}` : null,
            video.views ? `➤ 👁️ ${Number(video.views).toLocaleString()} views` : null,
            '',
            '📥 *𝗥𝗘𝗣𝗟𝗬 𝗪𝗜𝗧𝗛 𝗔 𝗡𝗨𝗠𝗕𝗘𝗥*',
            '➤ *1* ▸ 🎧 Audio',
            '➤ *2* ▸ 📄 Document',
            '➤ *3* ▸ 🎤 Voice note'
        );

        let card = null;
        if (thumbnail) card = await conn.sendMessage(from, { image: { url: thumbnail }, caption }, { quoted: mek }).catch(() => null);
        if (!card) card = await conn.sendMessage(from, { text: caption }, { quoted: mek });

        const cardId = card?.key?.id;
        if (!cardId) throw new Error('Could not send the options menu');

        sweep();
        pending.set(cardId, {
            session: conn.session?.number,
            chat: from,
            sender,
            videoUrl,
            title,
            expires: Date.now() + PENDING_TTL
        });
        await react('✅');
    } catch (err) {
        console.error('[PLAY] error:', err.message);
        await react('❌');
        await reply(box('❌ *𝗣𝗟𝗔𝗬 𝗘𝗥𝗥𝗢𝗥*', `➤ ${err.message}`, '➤ Please try again.'));
    }
});

// ---------------------------------------------------------------- reply "1 / 2 / 3" to a menu card
// Runs for every incoming text message (on: "body"); anything that isn't a reply to one of our cards is ignored.
cmd({
    on: 'body',
    dontAddCommandList: true,
    filename: __filename
}, async (conn, mek, m, { from, sender }) => {
    try {
        const cardId = m.quoted?.id;
        if (!cardId) return;
        const entry = pending.get(cardId);
        if (!entry) return;
        if (entry.expires < Date.now()) return void pending.delete(cardId);
        if (entry.session !== conn.session?.number || entry.chat !== from || entry.sender !== sender) return;

        const choice = parseChoice(m.body);
        if (!choice) return; // not a menu answer
        if (handled.has(m.id)) return;
        handled.add(m.id);
        pending.delete(cardId); // one choice per card (put back below if the download fails)

        const react = emoji => conn.sendMessage(from, { react: { text: emoji, key: mek.key } }).catch(() => {});
        try {
            await react('⏳');
            const mp3 = await fetchMp3(entry.videoUrl);
            await deliver(conn, from, mek, choice, mp3, entry.title);
            await react('✅');
        } catch (err) {
            console.error('[PLAY] delivery error:', err.message);
            entry.expires = Date.now() + PENDING_TTL;
            pending.set(cardId, entry); // reply again to retry
            await react('❌');
            await conn.sendMessage(from, {
                text: box('❌ *𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗 𝗙𝗔𝗜𝗟𝗘𝗗*', `➤ ${err.message}`, '➤ Reply 1, 2 or 3 again to retry.')
            }, { quoted: mek });
        }
    } catch (err) {
        console.error('[PLAY] onMessage error:', err.message);
    }
});
