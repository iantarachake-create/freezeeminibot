const { cmd } = require('../command');
const axios = require('axios');
const yts = require('yt-search');

const DL_API = 'https://api.qasimdev.dpdns.org/api/loaderto/download';
const API_KEY = 'xbps-install-Syu';

cmd({
    pattern: "play",
    alias: ["audio", "song"],
    desc: "Send a song from YouTube (audio only)",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) return reply("Usage: .play <song name or YouTube link>");

        const query = q.trim();
        let video;

        if (query.includes('youtube.com') || query.includes('youtu.be')) {
            video = { url: query, title: 'song' };
        } else {
            const search = await yts(query);
            video = search.videos && search.videos[0];
        }

        if (!video) return reply("Song not found.");

        const { data } = await axios.get(DL_API, {
            params: { apiKey: API_KEY, format: 'mp3', url: video.url },
            timeout: 90000
        });

        const audioUrl = data?.data?.downloadUrl;
        if (!audioUrl) throw new Error('No download link');

        // Only the song itself - no preview, no caption, no channel info
        await conn.sendMessage(from, {
            audio: { url: audioUrl },
            mimetype: 'audio/mpeg',
            fileName: `${video.title}.mp3`,
            ptt: false
        }, { quoted: mek });

    } catch (err) {
        console.error('play error:', err.message);
        reply("Song download failed. Please try again.");
    }
});
