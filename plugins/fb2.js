const config = require('../config');
const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
  pattern: 'fb2',
  desc: 'Download Facebook videos',
  category: 'downloader',
  filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
  try {
    if (!args[0]) return reply('❌ *Provide a Facebook video link*');

    await conn.sendMessage(from, { react: { text: '⏳', key: mek.key } });
    const v = await api.facebook(args[0]);

    const caption = `
╭═══〘 *FACEBOOK DOWNLOADER* 〙═══⊷
┃❍ *Title:* ${v.title || 'Facebook Video'}
┃❍ *Quality:* HD
┃❍ *Source:* Facebook
╰═════════════════════════⊷

> *${config.BOT_NAME || 'freezer'}*`.trim();

    await conn.sendMessage(from, { video: { url: v.hd || v.sd }, caption }, { quoted: mek });
    await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
  } catch (e) {
    console.error(e.message);
    reply('❌ *Failed to fetch that Facebook video.* Make sure it is public.');
  }
});
