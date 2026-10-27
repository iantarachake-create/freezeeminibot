'use strict';
// Small per-session message store (the original used one unbounded in-memory store for the whole server).
// Keeps the most recent messages so anti-delete can show a deleted one. Same interface the original code used:
// store.messages[chatId], store.loadMessage(jid, id).
const MAX = 500;

function createStore() {
    const byId = new Map();       // `${jid}|${id}` -> message
    const store = {
        messages: {},             // jid -> true (chats seen), as the original code only checks it exists
        bind(ev) {
            ev.on('messages.upsert', ({ messages }) => {
                for (const m of messages) {
                    if (!m?.key?.id || !m.message || m.key.remoteJid === 'status@broadcast') continue;
                    const jid = m.key.remoteJid;
                    store.messages[jid] = store.messages[jid] || {};
                    byId.set(`${jid}|${m.key.id}`, m);
                    if (byId.size > MAX) {
                        const oldest = byId.keys().next().value;
                        byId.delete(oldest);
                    }
                }
            });
        },
        async loadMessage(jid, id) { return byId.get(`${jid}|${id}`); }
    };
    return store;
}

module.exports = { createStore };
