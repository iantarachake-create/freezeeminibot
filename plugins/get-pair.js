const { cmd } = require('../command');

// SECURITY: this command used to call a third-party server (sessionscannert-1-m5sp.onrender.com) with the
// user's phone number and return a pairing code. Linking WhatsApp through someone else's server gives that
// server's owner full access to the account. Pairing now happens ONLY on this bot's own web page.
cmd({
    pattern: "pair",
    alias: ["getpair", "clonebot"],
    react: "✅",
    desc: "How to link your own WhatsApp to this bot",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { reply }) => {
    const site = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '';
    reply(site
        ? `🔗 *Link your WhatsApp*\n\nOpen this page and enter your number:\n${site.replace(/\/$/, '')}/\n\n_Only ever link through this bot's own page._`
        : `🔗 *Link your WhatsApp*\n\nOpen this bot's website and enter your number there.\n\n_Only ever link through this bot's own page._`);
});
