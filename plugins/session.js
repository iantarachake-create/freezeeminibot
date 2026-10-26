// Per-session controls. Every paired number has its OWN settings, nothing here touches other sessions.
const { cmd } = require('../command');
const config = require('../config');

const KEYS = {
  autoviewstatus: 'AUTO_VIEW_STATUS', autolikestatus: 'AUTO_LIKE_STATUS', autostatusreply: 'AUTO_STATUS_REPLY',
  autoread: 'READ_MESSAGE', autotyping: 'AUTO_TYPING', autorecording: 'AUTO_RECORDING',
  alwaysonline: 'ALWAYS_ONLINE', anticall: 'ANTI_CALL', antidelete: 'ANTI_DELETE',
  autoreact: 'AUTO_REACT', welcome: 'WELCOME_ENABLE', goodbye: 'GOODBYE_ENABLE'
};
const on = (v) => v === 'true';

cmd({
  pattern: 'settings', alias: ['setting', 'config'], react: '⚙️', category: 'owner',
  desc: 'Show / change this bot\'s settings', use: '.settings  |  .settings antidelete on', filename: __filename
}, async (conn, mek, m, { args, isOwner, reply, session }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  const st = session.settings;
  const key = (args[0] || '').toLowerCase();
  const val = (args[1] || '').toLowerCase();

  if (!key) {
    let t = `⚙️ *${config.BOT_NAME} SETTINGS*\n\n`;
    for (const [k, v] of Object.entries(KEYS)) t += `${on(st[v]) ? '✅' : '❌'} ${k}\n`;
    t += `\n🌐 mode: *${st.MODE || config.WORK_TYPE}*\n\n_Change:_ ${config.PREFIX}settings <name> on|off\n_Mode:_ ${config.PREFIX}settings mode public|private`;
    return reply(t);
  }
  if (key === 'mode') {
    if (!['public', 'private'].includes(val)) return reply('Use: .settings mode public|private');
    st.MODE = val; await session.saveSettings();
    return reply(`✅ mode → *${val}*`);
  }
  if (key === 'sudo') {
    const num = (args[1] || '').replace(/[^0-9]/g, '');
    if (!num) return reply('Use: .settings sudo 2547XXXXXXXX  (toggles that number as sub-owner)');
    const list = (st.SUDO || '').split(',').filter(Boolean);
    const i = list.indexOf(num);
    i >= 0 ? list.splice(i, 1) : list.push(num);
    st.SUDO = list.join(','); await session.saveSettings();
    return reply(i >= 0 ? `➖ removed ${num}` : `➕ added ${num}`);
  }
  const real = KEYS[key];
  if (!real) return reply('❌ Unknown setting. Send .settings to see the list.');
  if (!['on', 'off'].includes(val)) return reply(`Use: .settings ${key} on|off`);
  st[real] = val === 'on' ? 'true' : 'false';
  await session.saveSettings();
  if (real === 'ALWAYS_ONLINE') conn.sendPresenceUpdate(val === 'on' ? 'available' : 'unavailable').catch(() => {});
  return reply(`✅ *${key}* → ${val.toUpperCase()}`);
});

cmd({
  pattern: 'reboot', alias: ['restart', 'rebot'], react: '♻️', category: 'owner',
  desc: 'Reconnect this bot (other users are not affected)', filename: __filename
}, async (conn, mek, m, { isOwner, reply, session, manager }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  await reply('♻️ Reconnecting...');
  manager.restart(session.number);
});

cmd({
  pattern: 'logout', alias: ['unlink', 'disconnect'], react: '🚪', category: 'owner',
  desc: 'Unlink this bot from your WhatsApp and delete its session', filename: __filename
}, async (conn, mek, m, { isOwner, reply, session, manager, args }) => {
  if (!isOwner) return reply('🚫 Owner only.');
  if ((args[0] || '').toLowerCase() !== 'confirm') return reply(`⚠️ This removes the bot from your account.\nSend *${config.PREFIX}logout confirm* to continue.`);
  await reply('👋 Logged out. Open the pair page to link again any time.');
  setTimeout(() => manager.destroy(session.number, { wipe: true, logout: true }), 1500);
});

cmd({
  pattern: 'botstats', alias: ['sessions'], react: '📊', category: 'main',
  desc: 'How many numbers are running on this minibot', filename: __filename
}, async (conn, mek, m, { reply, manager, session }) => {
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  const up = Math.floor(process.uptime());
  reply(`📊 *${config.BOT_NAME}*\n\n👥 Sessions: ${manager.openCount()} online / ${manager.count()} total\n⏱️ Server uptime: ${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m\n🧠 RAM: ${mem}MB\n🔗 This session up: ${Math.floor((Date.now() - session.openedAt) / 60000)}m`);
});
