'use strict';
// Per-chat anti-delete switch. The original kept it in MongoDB; now it is part of the calling user's own data.
const { current } = require('../lib/context');

const DOC = 'antidelete.json';
const read = s => { try { return JSON.parse(s.docs[DOC] || '{}'); } catch { return {}; } };

const getAntideleteStatus = async (chatId) => {
    const s = current()?.session;
    if (!s) return false;
    return !!read(s)[chatId];
};

const setAntideleteStatus = async (chatId, status) => {
    const s = current()?.session;
    if (!s) return false;
    const data = read(s);
    data[chatId] = !!status;
    s.docs[DOC] = JSON.stringify(data);
    s.markDoc(DOC);
    return true;
};

module.exports = { getAntideleteStatus, setAntideleteStatus };
