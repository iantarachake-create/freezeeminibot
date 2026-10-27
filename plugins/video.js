const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "video",
    alias: ["ytmp4", "ytv"],
    desc: "Download video from YouTube by name or link",
    category: "main",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (!args[0]) return reply("❌ Give me a video name or YouTube link!\n\nExample:\n.video arike kumnie\n.video https://youtu.be/xxxx");

        const query = args.join(" ");
        const start = Date.now();
        await conn.sendMessage(from, { react: { text: "🎬", key: mek.key } });

        let videoUrl = query, title = null;
        if (!/youtube\.com|youtu\.be/i.test(query)) {
            const hit = await api.ytFind(query);
            if (!hit) return reply("❌ No results found for that video.");
            videoUrl = hit.url; title = hit.title;
        }

        const v = await api.youtube(videoUrl, 'video');
        title = title || v.title || "YouTube Video";

        await reply(`🎬 *YouTube Video Downloader*\n\n📌 *Title:* ${title}\n⚡ *Speed:* ${Date.now() - start} ms\n\n⬇️ Sending video...`);
        await conn.sendMessage(from, { video: { url: v.url }, mimetype: "video/mp4", caption: title }, { quoted: mek });
    } catch (err) {
        console.error(err.message);
        reply("❌ Couldn't get that video. Try another link or name.");
    }
});

cmd({
    pattern: "song",
    alias: ["ytmp3", "play", "yta"],
    desc: "Download YouTube audio by name or link",
    category: "main",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (!args[0]) return reply("❌ Give me a song name or YouTube link!\n\nExample:\n.song faded alan walker");

        const query = args.join(" ");
        await conn.sendMessage(from, { react: { text: "🎧", key: mek.key } });

        let videoUrl = query, title = null;
        if (!/youtube\.com|youtu\.be/i.test(query)) {
            const hit = await api.ytFind(query);
            if (!hit) return reply("❌ No results found for that song.");
            videoUrl = hit.url; title = hit.title;
        }

        const a = await api.youtube(videoUrl, 'audio');
        title = title || a.title || "audio";

        await conn.sendMessage(from, { audio: { url: a.url }, mimetype: "audio/mpeg", fileName: `${title}.mp3` }, { quoted: mek });
    } catch (err) {
        console.error(err.message);
        reply("❌ Couldn't get that song. Try another name or link.");
    }
});
