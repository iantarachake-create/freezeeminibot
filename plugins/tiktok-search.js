const { cmd } = require("../command");
const api = require("../lib/api");

cmd({
  pattern: "tiktoksearch",
  alias: ["tiktoks", "tiks"],
  desc: "Search for TikTok videos using a query.",
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
  if (!args[0]) return reply("🌸 What do you want to search on TikTok?\n\n*Usage Example:*\n.tiktoksearch <query>");

  const query = args.join(" ");
  const react = (t) => conn.sendMessage(from, { react: { text: t, key: mek.key } }).catch(() => {});
  await react('⌛');

  try {
    await reply(`🔎 Searching TikTok for: *${query}*`);
    const results = await api.tiktokSearch(query, 5);

    for (const v of results) {
      const caption = `🌸 *TikTok Video Result*:\n\n`
        + `*• Title*: ${v.title || 'Untitled'}\n`
        + `*• Author*: ${v.author || 'Unknown'}\n`
        + `*• Duration*: ${v.duration ? v.duration + 's' : 'Unknown'}\n`
        + (v.link ? `*• URL*: ${v.link}\n` : '');
      await conn.sendMessage(from, { video: { url: v.url }, caption }, { quoted: mek });
    }
    await react('✅');
  } catch (error) {
    console.error("TikTokSearch:", error.message);
    await react('❌');
    reply("❌ No results (or the search service is busy). Try different keywords or try again later.");
  }
});
