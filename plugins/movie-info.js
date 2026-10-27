const config = require('../config');
const { cmd } = require('../command');
const api = require('../lib/api');

// Remember each user's last search so they can reply with a number
const movieSelections = {};

function card(v, d) {
  const rating = d?.rating ? `${d.rating}/10${d.votes ? ` (${Number(d.votes).toLocaleString()} votes)` : ''}` : 'N/A';
  return `🎬 *${v.title}* ${v.year ? `(${v.year})` : ''}\n\n`
    + `🏷️ *Type:* ${v.type || 'N/A'}\n`
    + `⭐ *IMDb:* ${rating}\n`
    + (d?.genres?.length ? `🎭 *Genres:* ${d.genres.join(', ')}\n` : '')
    + (d?.runtime ? `⏳ *Runtime:* ${d.runtime} min\n` : '')
    + (v.stars ? `👥 *Cast:* ${v.stars}\n` : '')
    + (d?.plot ? `\n📝 *Plot:*\n${d.plot}\n` : '')
    + `\n🔗 https://www.imdb.com/title/${v.id}/\n\n> *freezer movie finder*`;
}

cmd({
  pattern: "movieinfo",
  alias: ["imdb"],
  desc: "Search a movie/series and get its details",
  category: "media",
  react: "🎞️",
  filename: __filename
}, async (conn, mek, m, { from, args, sender, reply }) => {
  try {
    const query = args.join(" ");
    if (!query) return reply("❗ Please provide a movie name.\nExample: `.movieinfo avatar`");

    const results = (await api.movieSearch(query)).slice(0, 5);

    let textMsg = `🟩 *FREEZER MOVIE FINDER*\n\n🎬 *Results for:* _${query}_\n\nReply with a number *(1-${results.length})* to see details.\n\n`;
    results.forEach((v, i) => { textMsg += `*${i + 1}. ${v.title}* (${v.year || '?'}) — ${v.type || ''}\n`; });

    movieSelections[sender] = results;
    setTimeout(() => { delete movieSelections[sender]; }, 5 * 60 * 1000);
    await conn.sendMessage(from, { text: textMsg }, { quoted: mek });
  } catch (e) {
    console.error('movieinfo:', e.message);
    reply(`❌ No movies found (or the movie service is busy). Try another title.`);
  }
});

// number reply (1–5)
cmd({ on: "text" }, async (conn, mek, m, { from, body, sender, reply }) => {
  try {
    const list = movieSelections[sender];
    if (!list) return;
    const choice = parseInt((body || '').trim());
    if (isNaN(choice) || choice < 1 || choice > list.length || String(choice) !== (body || '').trim()) return;

    delete movieSelections[sender];
    const v = list[choice - 1];
    const d = await api.movieDetails(v.id);
    const poster = d?.poster || v.poster;
    if (poster) await conn.sendMessage(from, { image: { url: poster }, caption: card(v, d) }, { quoted: mek }).catch(() => reply(card(v, d)));
    else await reply(card(v, d));
  } catch (e) {
    console.error('movieinfo reply:', e.message);
  }
});
