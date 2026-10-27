const { cmd } = require("../command");
const api = require("../lib/api");

cmd({
  pattern: "rw",
  alias: ["randomwall", "wallpaper"],
  react: "🌌",
  desc: "Download random wallpapers based on keywords.",
  category: "wallpapers",
  use: ".rw <keyword>",
  filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
  try {
    const query = args.join(" ");
    let url;
    if (query) {
      const [img] = await api.images(`${query} wallpaper`, 1);
      url = img?.url;
    } else {
      url = `https://picsum.photos/1080/1920?random=${Date.now()}`;
    }
    if (!url) return reply(`❌ No wallpaper found for *"${query}"*.`);
    await conn.sendMessage(from, { image: { url }, caption: `🌌 *Random Wallpaper: ${query || 'random'}*\n\n> *© freezer*` }, { quoted: mek });
  } catch (error) {
    console.error("Wallpaper Error:", error.message);
    reply(`❌ No wallpaper found. Try another keyword.`);
  }
});
