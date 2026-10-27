const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "metaai",
    alias: ["freezerai", "meta"],
    react: "🤖",
    desc: "Talk with the AI assistant",
    category: "ai",
    use: '.metaai <your question>',
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    const react = (t) => conn.sendMessage(from, { react: { text: t, key: mek.key } }).catch(() => {});
    try {
        if (!q) return reply("❌ Please provide a question.");
        await react('⏳');
        await conn.sendPresenceUpdate("composing", from).catch(() => {});
        const answer = await api.ai(q);
        await react('✅');
        await reply(`💬 *AI:* ${answer}`);
    } catch (e) {
        console.error("MetaAI:", e.message);
        await react('❌');
        reply("❌ The AI service didn't respond. Please try again in a moment.");
    }
});
