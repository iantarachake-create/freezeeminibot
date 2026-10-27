const { cmd } = require('../command');

cmd({
  pattern: "ytstalk",
  alias: ["ytinfo"],
  desc: "Get details about a YouTube channel.",
  react: "🔍",
  category: "search",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("❌ Please provide a YouTube channel name.");
    await conn.sendMessage(from, { react: { text: "⏳", key: mek.key } });

    const yts = require('yt-search');
    const r = await yts(q);
    const ch = r?.channels?.[0];
    if (!ch) return reply("⚠️ Channel not found. Try the exact channel name.");

    const caption = `╭━━━〔 *YOUTUBE STALKER* 〕━━━⊷\n`
      + `┃👤 *Channel:* ${ch.name}\n`
      + `┃📊 *Subscribers:* ${ch.subCountLabel || ch.subCount || 'N/A'}\n`
      + `┃🎥 *Videos:* ${ch.videoCount ?? 'N/A'}\n`
      + `┃🔗 *Link:* ${ch.url}\n`
      + `╰━━━⪼\n\n🔹 *freezer*`;

    const img = ch.image || ch.thumbnail;
    if (img) await conn.sendMessage(from, { image: { url: img.startsWith('//') ? 'https:' + img : img }, caption }, { quoted: mek });
    else await reply(caption);
  } catch (error) {
    console.error("ytstalk:", error.message);
    reply("❌ An error occurred while processing your request. Please try again.");
  }
});
