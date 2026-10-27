const api = require('../lib/api');
const { cmd } = require('../command');

cmd({
    pattern: "news",
    desc: "Get the latest news headlines.",
    category: "news",
    react: "📰",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        const articles = await api.news(5);
        for (const a of articles) {
            const message = `📰 *${a.title}*\n${a.description ? `⚠️ _${a.description}_\n` : ''}🔗 _${a.url}_\n\n  *freezer xtr*`;
            if (a.image) {
                await conn.sendMessage(from, { image: { url: a.image }, caption: message }, { quoted: mek })
                    .catch(() => conn.sendMessage(from, { text: message }, { quoted: mek }));
            } else {
                await conn.sendMessage(from, { text: message }, { quoted: mek });
            }
        }
    } catch (e) {
        console.error("news:", e.message);
        reply("Could not fetch news. Please try again later.");
    }
});
