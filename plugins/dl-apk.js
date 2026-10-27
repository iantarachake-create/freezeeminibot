const { cmd } = require('../command');
const api = require('../lib/api');

cmd({
    pattern: "apk",
    alias: ["app"],
    react: "📲",
    desc: "📥 Download APK directly",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    const react = (t) => conn.sendMessage(from, { react: { text: t, key: mek.key } }).catch(() => {});
    try {
        if (!q) return reply("❌ *Please provide an app name!*");
        await react('⏳');

        const app = await api.apk(q);
        const mb = app.size ? (app.size / 1048576) : 0;
        if (mb > 300) { await react('❌'); return reply(`❌ *${app.name}* is ${mb.toFixed(0)} MB — too big to send on WhatsApp.`); }

        await conn.sendMessage(from, {
            document: { url: app.url },
            mimetype: "application/vnd.android.package-archive",
            fileName: `${app.name}.apk`,
            caption: `✅ *${app.name}*\n📦 ${app.package}\n🏷️ v${app.version || '?'}${mb ? `  •  ${mb.toFixed(1)} MB` : ''}\n\nꜰʀᴇᴇᴢᴇʀ ᴀᴘᴘs 🤍`
        }, { quoted: mek });
        await react('✅');
    } catch (error) {
        console.error('apk:', error.message);
        await react('❌');
        reply("❌ *No app found with that name, or the download is unavailable.*");
    }
});
