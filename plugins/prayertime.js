const config = require('../config');
const api = require('../lib/api');
const { cmd } = require('../command');

cmd({
    pattern: "praytime",
    alias: ["prayertimes", "prayertime", "ptime"],
    react: "✅",
    desc: "Get the prayer times for a city. Example: .praytime Lahore",
    category: "information",
    filename: __filename,
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        const city = args.length ? args.join(" ") : (process.env.PRAYER_CITY || "Bhakkar");
        const r = await api.prayer(city);
        const t = r.timings;
        const clean = (x) => String(x || '').split(' ')[0];

        let dec = `*Prayer Times for ${city}*\n\n`;
        dec += `📅 *Date*: ${r.date?.readable || ''}${r.date?.hijri ? `  (${r.date.hijri.day} ${r.date.hijri.month?.en} ${r.date.hijri.year} AH)` : ''}\n`;
        dec += `🕌 *Method*: ${r.meta?.method?.name || 'Standard'}\n`;
        dec += `🕰️ *Timezone*: ${r.meta?.timezone || ''}\n\n`;
        dec += `🌅 *Fajr*: ${clean(t.Fajr)}\n`;
        dec += `🌄 *Sunrise*: ${clean(t.Sunrise)}\n`;
        dec += `☀️ *Dhuhr*: ${clean(t.Dhuhr)}\n`;
        dec += `🌇 *Asr*: ${clean(t.Asr)}\n`;
        dec += `🌆 *Maghrib*: ${clean(t.Maghrib)}\n`;
        dec += `🌃 *Isha*: ${clean(t.Isha)}\n`;
        if (r.qibla) dec += `\n🧭 *Qibla Direction*: ${Number(r.qibla).toFixed(1)}°\n`;

        await conn.sendMessage(from, { image: { url: `https://files.catbox.moe/kiy0hl.jpg` }, caption: dec }, { quoted: mek });
    } catch (e) {
        console.error('praytime:', e.message);
        reply('❌ Could not find prayer times for that city. Try e.g. *.praytime Lahore* or *.praytime London, UK*');
    }
});
