const config = require('../config');
const axios = require('axios');
const { cmd } = require('../command');

cmd({
  pattern: 'music',
  alias: ['whatmusic', 'shazam'],
  desc: 'Identify music from audio, video, or URL',
  category: 'tools',
  filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
  try {
    let audioUrl;

    // 1️⃣ If user replies to audio or video
    if (m.quoted && (m.quoted.audio || m.quoted.video)) {
      await conn.sendMessage(from, {
        react: { text: '🎧', key: mek.key }
      });

      const media = await m.quoted.download();
      if (!media) return reply('❌ *Failed to download replied media*');

      // Upload media to get public URL
      audioUrl = await conn.uploadFile(media);

    }
    // 2️⃣ If user provides direct URL
    else if (args[0]) {
      audioUrl = args[0];
    }
    // 3️⃣ Nothing provided
    else {
      return reply(
        '❌ *Reply to an audio/video or provide a URL*\n\n' +
        'Example:\n.music <audio_url>'
      );
    }

    const api = `https://api.deline.web.id/tools/whatmusic?url=${encodeURIComponent(audioUrl)}`;

    const { data } = await axios.get(api);

    if (!data.status || !data.result) {
      return reply('❌ *Unable to identify this music*');
    }

    const { title, artists } = data.result;

    const caption = `
╭═══〘 *MUSIC IDENTIFIED* 〙═══⊷
┃❍ *Title:* ${title}
┃❍ *Artist:* ${artists}
╰═════════════════════════⊷

> *${config.BOT_NAME || 'FREEZER-MD'}*
> Powered by Deline API
    `.trim();

    await conn.sendMessage(from, {
      text: caption,
      contextInfo: {
        forwardingScore: 5,
        isForwarded: true,
        externalAdReply: {
          title: title,
          body: artists,
          sourceUrl: audioUrl,
          mediaType: 1,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: mek });

    await conn.sendMessage(from, {
      react: { text: '✅', key: mek.key }
    });

  } catch (e) {
    console.error(e);
    reply(`❌ Error: ${e.message}`);
  }
});
