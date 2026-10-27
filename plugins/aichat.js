const { cmd } = require('../command');
const api = require('../lib/api');

function aiCommand({ pattern, alias, react: emoji, title, model, usage }) {
    cmd({ pattern, alias, desc: `Chat with ${title}`, category: "ai", react: emoji, filename: __filename },
    async (conn, mek, m, { from, q, reply }) => {
        const react = (t) => conn.sendMessage(from, { react: { text: t, key: mek.key } }).catch(() => {});
        try {
            if (!q) return reply(`Please provide a message.\nExample: \`${usage}\``);
            await conn.sendPresenceUpdate("composing", from).catch(() => {});
            const answer = await api.ai(q, { model });
            await reply(`${emoji} *${title}:*\n\n${answer}`);
            await react("✅");
        } catch (e) {
            console.error(`AI (${pattern}):`, e.message);
            await react("❌");
            reply("❌ The AI service didn't respond. Please try again in a moment.");
        }
    });
}

aiCommand({ pattern: "ai", alias: ["bot", "dj", "gpt", "gpt4", "bing"], react: "🤖", title: "AI Response", model: "openai", usage: ".ai Hello" });
aiCommand({ pattern: "openai", alias: ["chatgpt", "gpt3", "open-gpt"], react: "🧠", title: "OpenAI Response", model: "openai", usage: ".openai Hello" });
aiCommand({ pattern: "deepseek", alias: ["deep", "seekai"], react: "🧠", title: "DeepSeek Response", model: "deepseek", usage: ".deepseek Hello" });
