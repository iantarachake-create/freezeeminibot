const { cmd } = require("../command");
const api = require("../lib/api");

cmd({
    pattern: "img",
    alias: ["image", "searchimg"],
    react: "🫧",
    desc: "Search and download images",
    category: "fun",
    use: ".img <keywords> [number_of_images]",
    filename: __filename
}, async (conn, mek, m, { reply, args, from }) => {
    try {
        if (!args.length) return reply("🖼️ Please provide a search query\nExample: .img cute cats 3");

        let count = parseInt(args[args.length - 1]);
        const hasCount = !isNaN(count);
        if (!hasCount) count = 3;
        count = Math.min(Math.max(count, 1), 8);
        const query = (hasCount ? args.slice(0, -1) : args).join(" ");
        if (!query) return reply("🖼️ Please provide a search query\nExample: .img cute cats 3");

        await reply(`🔍 Searching images for "${query}"...`);
        const found = await api.images(query, count);

        let sent = 0;
        for (const image of found) {
            try {
                await conn.sendMessage(from, { image: { url: image.url }, caption: `*📷 Result for*: ${query}\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ ꜰʀᴇᴇᴢᴇʀ*` }, { quoted: mek });
                sent++;
            } catch (e) { /* skip a broken image URL */ }
            await new Promise(r => setTimeout(r, 800));
        }
        if (!sent) reply("❌ Found results but none could be downloaded. Try different keywords.");
    } catch (error) {
        console.error("Image Search Error:", error.message);
        reply("❌ No images found. Try different keywords.");
    }
});
