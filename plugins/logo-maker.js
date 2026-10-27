// Logo / text-effect commands. These used to call a web API (api-pink-venom / ephoto360) that is now dead.
// They are rendered locally by lib/textimg.js, so they work without any outside service.
const { cmd } = require('../command');
const textimg = require('../lib/textimg');

const DESCS = {
    '3dcomic': '3D comic-style text', dragonball: 'Dragon Ball style text', deadpool: 'Deadpool style text',
    blackpink: 'Blackpink neon pink text', neonlight: 'Colourful neon light text', cat: 'Cute cat-style text',
    sadgirl: 'Moody sad-girl text', naruto: 'Naruto style text', thor: 'Thor lightning text',
    america: 'American flag 3D text', eraser: 'Eraser / sketch outline text', '3dpaper': '3D paper-cut text',
    futuristic: 'Futuristic glitch text', clouds: 'Text in the clouds', sans: 'Sans-style glow text',
    galaxy: 'Galaxy text', leaf: 'Green leaf text', sunset: 'Sunset light text',
    nigeria: 'Nigerian flag 3D text', devilwings: 'Neon devil text', hacker: 'Hacker matrix text',
    boom: 'Comic BOOM text', luxury: 'Luxury gold 3D text', zodiac: 'Zodiac star text',
    angelwings: 'Angel glow text', bulb: 'Light-bulb marquee text', tatoo: 'Tattoo ink text',
    castle: 'Castle sunset 3D text', frozen: 'Frozen ice text', paint: 'Colourful paint text',
    birthday: 'Birthday balloon-style text', typography: 'Typography status text', bear: 'Teddy-bear 3D text',
};

async function send(conn, mek, from, buffer, caption) {
    await conn.sendMessage(from, { image: buffer, caption: caption || '> *freezer*' }, { quoted: mek });
}

for (const name of textimg.presets) {
    cmd({
        pattern: name,
        desc: `Create a "${DESCS[name] || name}" logo`,
        category: "logo",
        react: "🎨",
        filename: __filename
    }, async (conn, mek, m, { from, args, reply }) => {
        try {
            if (!args.length) return reply(`❌ Please provide a name. Example: ${name} Empire`);
            const img = await textimg.logo(name, args.join(" ").slice(0, 60));
            await send(conn, mek, from, img);
        } catch (e) {
            console.error(`logo ${name}:`, e.message);
            reply(`*Could not create the logo.*\n\n_Error:_ ${e.message}`);
        }
    });
}

cmd({
    pattern: "pornhub",
    alias: ["badge", "twotone"],
    desc: "Two-tone badge logo. Example: pornhub Free Zone",
    category: "logo",
    react: "🎨",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (!args.length) return reply("❌ Please provide text. Example: pornhub Free Zone");
        await send(conn, mek, from, await textimg.badge(args.join(" ").slice(0, 40)));
    } catch (e) {
        console.error("logo badge:", e.message);
        reply(`*Could not create the logo.*\n\n_Error:_ ${e.message}`);
    }
});

cmd({
    pattern: "valorant",
    desc: "Valorant-style banner. Example: valorant Top Player Freezer",
    category: "logo",
    react: "🎨",
    filename: __filename
}, async (conn, mek, m, { from, args, reply }) => {
    try {
        if (args.length < 3) return reply("❌ Please provide three words. Example: valorant Top Player Freezer");
        const img = await textimg.banner(args[0], args[1], args.slice(2).join(" ").slice(0, 30));
        await send(conn, mek, from, img, "Here is your Valorant banner!");
    } catch (e) {
        console.error("logo valorant:", e.message);
        reply(`*Could not create the banner.*\n\n_Error:_ ${e.message}`);
    }
});

cmd({
    pattern: "logolist",
    alias: ["logomenu", "logos"],
    desc: "List all logo styles",
    category: "logo",
    filename: __filename
}, async (conn, mek, m, { reply, config }) => {
    const p = (config && config.PREFIX) || '.';
    reply(`🎨 *LOGO STYLES*\n\n${[...textimg.presets, 'pornhub', 'valorant'].map(n => `• ${p}${n} <text>`).join('\n')}`);
});
