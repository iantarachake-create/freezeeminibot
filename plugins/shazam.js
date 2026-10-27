const config = require('../config');
const api = require('../lib/api');
const { cmd } = require('../command');

cmd({
  pattern: 'music',
  alias: ['whatmusic', 'shazam'],
  desc: 'Identify a song from a replied audio/video or a URL',
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
  try {
    let audioUrl;
    const quoted = mek.quoted || m.quoted;

    if (quoted && (quoted.audio || quoted.video)) {
      await conn.sendMessage(from, { react: { text: '🎧', key: mek.key } });
      const media = await quoted.download();
      if (!media) return reply('❌ *Failed to download replied media*');
      audioUrl = await api.uploadCatbox(media, quoted.video ? 'clip.mp4' : 'clip.mp3');
    } else if (args[0]) {
      audioUrl = args[0];
    } else {
      return reply('❌ *Reply to an audio/video or provide a URL*\n\nExample:\n.music <audio_url>');
    }

    const r = await api.whatMusic(audioUrl);
    if (!r) return reply('❌ *Unable to identify this music*');

    await conn.sendMessage(from, {
      text: `╭═══〘 *MUSIC IDENTIFIED* 〙═══⊷\n┃❍ *Title:* ${r.title}\n┃❍ *Artist:* ${r.artist}\n${r.album ? `┃❍ *Album:* ${r.album}\n` : ''}${r.released ? `┃❍ *Released:* ${r.released}\n` : ''}${r.link ? `┃❍ *Link:* ${r.link}\n` : ''}╰═════════════════════════⊷\n\n> *${config.BOT_NAME || 'freezer'}*`
    }, { quoted: mek });
    await conn.sendMessage(from, { react: { text: '✅', key: mek.key } });
  } catch (e) {
    if (e.code === 'NOT_CONFIGURED') {
      return reply('⚙️ Song recognition needs a free token from https://audd.io\nSet *AUDD_API_TOKEN* in bot.env and restart.');
    }
    console.error('music:', e.message);
    reply('❌ Could not identify that song.');
  }
});
