const { cmd } = require('../command');

cmd({
    pattern: "wstalk",
    alias: ["channelstalk", "chinfo"],
    desc: "Get WhatsApp channel information",
    category: "utility",
    react: "🔍",
    filename: __filename
}, async (conn, mek, m, { from, reply, args }) => {
    try {
        const link = args[0] || '';
        const channelId = link.match(/channel\/([0-9A-Za-z_-]+)/i)?.[1];
        if (!channelId) return reply("❌ Please provide a WhatsApp channel URL\nExample: .wstalk https://whatsapp.com/channel/0029VatOy2EAzNc2WcShQw1j");

        // Ask WhatsApp itself (no third-party API needed)
        const meta = await conn.newsletterMetadata("invite", channelId);
        if (!meta || !meta.id) return reply("❌ Channel not found or inaccessible.");

        const info = `╭━━〔 *CHANNEL INFO* 〕━━┈⊷\n`
            + `┃◈┃• *📢 Title*: ${meta.name}\n`
            + `┃◈┃• *🆔 ID*: ${meta.id}\n`
            + `┃◈┃• *👥 Followers*: ${meta.subscribers?.toLocaleString?.() ?? meta.subscribers ?? 'N/A'}\n`
            + `┃◈┃• *✅ Verified*: ${meta.verification === 'VERIFIED' ? 'Yes' : 'No'}\n`
            + `┃◈┃• *📅 Created*: ${meta.creation_time ? new Date(meta.creation_time * 1000).toDateString() : 'Unknown'}\n`
            + `┃◈┃• *📝 Description*: ${(meta.description || 'None').replace(/\n/g, '\n┃◈┃  ')}\n`
            + `╰──────────────┈⊷\n> *freezer*`;

        const previewPath = meta.preview || meta.picture?.directPath;
        if (previewPath) {
            const img = `https://pps.whatsapp.net${previewPath}`;
            await conn.sendMessage(from, { image: { url: img }, caption: info }, { quoted: mek }).catch(() => reply(info));
        } else {
            await reply(info);
        }
    } catch (e) {
        console.error("wstalk:", e.message);
        reply("❌ Couldn't read that channel. Make sure the link is correct.");
    }
});
