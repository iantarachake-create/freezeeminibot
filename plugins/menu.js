const config = require('../config');
const os = require('os');
const moment = require('moment-timezone');
const { cmd, commands } = require('../command');

// FREEZER MD MENU IMAGE
const menuImageUrl = 'https://i.ibb.co/v6D9R8mm/IMG-20261027-WA0049-1.jpg';

// Helpers
const monospace = (text) => `\`${text}\``;

const formatSize = (bytes) => {
    if (bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(1) + 'GB';
    }
    return (bytes / 1048576).toFixed(1) + 'MB';
};

const formatUptime = (seconds) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);

    return `${d}d ${h}h ${m}m ${s}s`;
};

cmd({
    pattern: 'menu',
    alias: ['help', 'allmenu'],
    react: '✅',
    category: 'main',
    filename: __filename,
    desc: 'Show FREEZER MD main menu'
}, async (conn, mek, m, {
    from, sender, pushName, reply
}) => {
    try {
        const timeZone = 'Africa/Nairobi';
        const time = moment.tz(timeZone).format('hh:mm:ss A');
        const date = moment.tz(timeZone).format('DD/MM/YYYY');
        const uptime = formatUptime(process.uptime());

        const ram =
            `${formatSize(os.totalmem() - os.freemem())}/` +
            `${formatSize(os.totalmem())}`;

        const mode =
            config.MODE === 'public' ? 'PUBLIC' : 'PRIVATE';

        const userName = pushName || 'User';
        const botName = config.BOT_NAME || 'FREEZER MD';

        // Group commands by category
        const commandsByCategory = {};
        let totalCommands = 0;

        commands.forEach(command => {
            if (
                command.pattern &&
                !command.dontAdd &&
                command.category
            ) {
                const category = command.category.toUpperCase();

                if (!commandsByCategory[category]) {
                    commandsByCategory[category] = [];
                }

                commandsByCategory[category].push(
                    command.pattern.split('|')[0]
                );

                totalCommands++;
            }
        });

        // Build menu caption
        let menu = `╭══〘 *${monospace(botName)}* 〙══⊷
┃❍ *Mode:* ${monospace(mode)}
┃❍ *User:* ${monospace(userName)}
┃❍ *Plugins:* ${monospace(totalCommands)}
┃❍ *Uptime:* ${monospace(uptime)}
┃❍ *Time:* ${monospace(time)}
┃❍ *Date:* ${monospace(date)}
┃❍ *RAM:* ${monospace(ram)}
╰═════════════════⊷

*COMMAND LIST ⤵*`;

        // Add categories
        for (const category of Object.keys(commandsByCategory).sort()) {
            menu += `\n\n╭━━━━❮ *${monospace(category)}* ❯━⊷\n`;

            commandsByCategory[category]
                .sort()
                .forEach(commandName => {
                    menu += `┃✞ ${monospace(
                        (config.PREFIX || '.') + commandName
                    )}\n`;
                });

            menu += `╰━━━━━━━━━━━━━━━━━⊷`;
        }

        menu += `\n\n> *${botName}* © 2026 🇰🇪`;

        // Send ONE image with the menu caption.
        // No externalAdReply thumbnail, so no duplicate image.
        await conn.sendMessage(
            from,
            {
                image: { url: menuImageUrl },
                caption: menu,
                contextInfo: {
                    mentionedJid: [sender]
                }
            },
            { quoted: mek }
        );

    } catch (error) {
        console.error('FREEZER MD menu error:', error);
        reply('❌ Menu processing error.');
    }
});
