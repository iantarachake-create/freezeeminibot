const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "movie",
    alias: ["film"],
    desc: "Get details of a movie or series. Example: .movie inception",
    category: "download",
    react: "🎬",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const query = args.join(" ");
        if (!query) return reply("❗ Give me a movie name.\nExample: `.movie inception`");

        const [v] = await api.movieSearch(query);
        const d = await api.movieDetails(v.id);

        const caption = `🎬 *${v.title}* ${v.year ? `(${v.year})` : ''}\n\n`
            + `🏷️ *Type:* ${v.type || 'N/A'}\n`
            + `⭐ *IMDb:* ${d?.rating ? d.rating + '/10' : 'N/A'}\n`
            + (d?.genres?.length ? `🎭 *Genres:* ${d.genres.join(', ')}\n` : '')
            + (d?.runtime ? `⏳ *Runtime:* ${d.runtime} min\n` : '')
            + (v.stars ? `👥 *Cast:* ${v.stars}\n` : '')
            + (d?.plot ? `\n📝 ${d.plot}\n` : '')
            + `\n🔗 https://www.imdb.com/title/${v.id}/\n\n> powered by freezer tech`;

        const poster = d?.poster || v.poster;
        if (poster) await conn.sendMessage(from, { image: { url: poster }, caption }, { quoted: mek });
        else await reply(caption);
    } catch (e) {
        console.error('movie:', e.message);
        reply("❌ No results found. Try another title.");
    }
});
