const config = require('../config');
const { cmd } = require('../command');
const fetch = require('node-fetch');

// Store user selections temporarily
const movieSelections = {};

cmd({
  pattern: "movieinfo",
  desc: "Search and download movies with selection",
  category: "media",
  react: "🎞️",
  filename: __filename
},
async (conn, mek, m, { from, args, sender, reply }) => {
  try {
    const query = args.join(" ");
    if (!query) {
      return reply("❗ Please provide a movie name.\nExample: `.movie avatar`");
    }

    // Send loading message
    const searching = await conn.sendMessage(from, { 
      text: `🔍 *Searching for:* _${query}_ ...` 
    });

    // Search movie from API
    const res = await fetch(`https://movieapi.giftedtech.co.ke/api/search/${encodeURIComponent(query)}`);
    const json = await res.json();

    if (!json.results || !json.results.items || json.results.items.length === 0) {
      return reply(`❌ No movies found for *${query}*`);
    }

    // Take the first 5 results
    const results = json.results.items.slice(0, 5);

    let textMsg = `🟩 *FREEZER MOVIE FINDER*\n\n🎬 *Results for:* _${query}_\n\n`;
    textMsg += `Reply with a number *(1-5)* to choose a movie.\n\n`;

    results.forEach((v, i) => {
      textMsg += `*${i + 1}. ${v.title}* (${v.year})\n`;
    });

    // Save results for user
    movieSelections[sender] = results;

    await conn.sendMessage(from, {
      text: textMsg,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: "120363289379419860@newsletter",
          newsletterName: "Freezer XTR",
          serverMessageId: 202
        }
      }
    }, { quoted: mek });

  } catch (e) {
    console.log(e);
    reply(`❌ Error: ${e.message}`);
  }
});


// LISTENER FOR USER NUMBER REPLY (1–5)
cmd({
  on: "text",
},
async (conn, mek, m, { from, body, sender, reply }) => {
  try {
    if (!movieSelections[sender]) return;

    const msg = body.trim();
    const choice = parseInt(msg);

    if (isNaN(choice) || choice < 1 || choice > 5) return;

    const selectedMovie = movieSelections[sender][choice - 1];
    delete movieSelections[sender];

    const movieId = selectedMovie.subjectId;

    // Fetch movie info
    const info = await fetch(`https://movieapi.giftedtech.co.ke/api/info/${movieId}`);
    const infoJson = await info.json();
    const subject = infoJson.results.subject;

    // Fetch streaming sources
    const src = await fetch(`https://movieapi.giftedtech.co.ke/api/sources/${movieId}`);
    const srcJson = await src.json();
    const sources = srcJson.results;

    if (!sources || sources.length === 0) {
      return reply(`❌ No download available for *${subject.title}*`);
    }

    // Pick best quality
    const best = sources.sort((a, b) => parseInt(b.quality) - parseInt(a.quality))[0];

    // Send poster & description
    await conn.sendMessage(from, {
      image: { url: subject.cover },
      caption:
        `🎬 *${subject.title}*\n\n` +
        `📆 *Released:* ${subject.releaseDate}\n` +
        `⭐ *Rating:* ${subject.rating}\n` +
        `⏳ *Duration:* ${Math.floor(subject.duration / 60)} min\n\n` +
        `📝 *Description:*\n${subject.description}\n\n` +
        `📺 *Selected Quality:* ${best.quality}\n\n` +
        `Preparing your download... ⬇️`
    }, {
      quoted: mek,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: "120363289379419860@newsletter",
          newsletterName: "Freezer XTR",
          serverMessageId: 203
        }
      }
    });

    // SEND AS DOCUMENT (not video)
    await conn.sendMessage(from, {
      document: { url: best.download_url },
      mimetype: "application/octet-stream",
      fileName: `${subject.title}-${best.quality}.mp4`,
      caption: `🎞️ *${subject.title}* • ${best.quality}`
    });

  } catch (e) {
    console.log(e);
    reply(`❌ Error: ${e.message}`);
  }
});
