const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "tiktok",
    alias: ["tt", "ttdl"],
    desc: "Download TikTok video without watermark",
    category: "main",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (!args[0]) return reply("❌ Please provide a TikTok link!\n\nExample:\n.tiktok https://vt.tiktok.com/ZSag54Wbe/");

        const start = Date.now();
        await conn.sendMessage(from, { react: { text: "🎵", key: mek.key } });

        const v = await api.tiktok(args[0]);

        const caption =
            `🎵 *TikTok Downloader*\n\n` +
            `📌 *Title:* ${v.title || "Unknown"}\n` +
            `👤 *Author:* ${v.author || "Unknown"}\n` +
            `⚡ *Speed:* ${Date.now() - start} ms`;

        await conn.sendMessage(from, { video: { url: v.video }, mimetype: "video/mp4", caption }, { quoted: mek });
    } catch (err) {
        console.error(err.message);
        reply("❌ Couldn't download that TikTok. Check the link is public and try again in a moment.");
    }
});
