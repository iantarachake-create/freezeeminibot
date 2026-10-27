const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "ig",
    desc: "Download Instagram reels/posts",
    category: "main",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (!args[0]) return reply("❌ Please provide an Instagram link!\n\nExample:\n.ig https://www.instagram.com/reel/xxxx/");

        await conn.sendMessage(from, { react: { text: "📸", key: mek.key } });
        const media = await api.instagram(args[0]);

        // carousels: send up to 5 items
        for (const item of media.slice(0, 5)) {
            if (item.type === 'video') {
                await conn.sendMessage(from, { video: { url: item.url }, mimetype: "video/mp4", caption: "📸 *Instagram Downloader*" }, { quoted: mek });
            } else {
                await conn.sendMessage(from, { image: { url: item.url }, caption: "📸 *Instagram Downloader*" }, { quoted: mek });
            }
        }
    } catch (err) {
        console.error(err.message);
        reply("❌ Couldn't download that Instagram link. It may be private or the service is busy — try again shortly.");
    }
});
