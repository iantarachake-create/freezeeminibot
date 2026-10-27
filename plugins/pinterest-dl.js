const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "pindl",
    alias: ["pinterestdl", "pint", "pins", "pindownload"],
    desc: "Download media from Pinterest",
    category: "download",
    react: "📌",
    filename: __filename
}, async (conn, mek, m, { args, from, reply }) => {
    const react = (t) => conn.sendMessage(from, { react: { text: t, key: mek.key } }).catch(() => {});
    try {
        if (!args[0]) { await react("⚠️"); return reply('❎ Please provide the Pinterest URL to download from.'); }
        await react("⏳");

        const pin = await api.pinterest(args[0]);
        const desc = `*┏────〘 freezer 〙───⊷*\n*┃* *PINS DOWNLOADER*\n*┃* *Title* - ${pin.title}\n*┗──────────────⊷*\n> powered by freezer`;

        if (pin.video) await conn.sendMessage(from, { video: { url: pin.video }, caption: desc }, { quoted: mek });
        else await conn.sendMessage(from, { image: { url: pin.image }, caption: desc }, { quoted: mek });
        await react("✅");
    } catch (e) {
        console.error(e.message);
        await react("❌");
        reply('❎ Could not fetch that pin. Check the link is public.');
    }
});
