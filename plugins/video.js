const { cmd } = require('../command');
const axios = require('axios');
const yts = require('yt-search');
const api = require('../lib/api');

const DL_API = 'https://api.qasimdev.dpdns.org/api/loaderto/download';
const API_KEY = 'xbps-install-Syu';

cmd({
    pattern: "video",
    alias: ["ytmp4", "ytv"],
    desc: "Send a YouTube video (video only, no extras)",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) return reply("Usage: .video <video name or YouTube link>");

        const query = q.trim();
        let video;

        if (/youtube\.com|youtu\.be/i.test(query)) {
            video = { url: query, title: 'video' };
        } else {
            const search = await yts(query);
            video = search.videos && search.videos[0];
        }

        if (!video) return reply("Video not found.");

        let videoUrl;
        const errors = [];

        // 1) main API
        try {
            const { data } = await axios.get(DL_API, {
                params: { apiKey: API_KEY, format: 'mp4', url: video.url },
                timeout: 90000
            });
            videoUrl = data?.data?.downloadUrl;
            if (!videoUrl) errors.push('qasim: no link ' + JSON.stringify(data).slice(0, 150));
        } catch (e) {
            errors.push('qasim: ' + (e.response?.status || '') + ' ' + e.message);
        }

        // 2) fallback providers already built into the bot
        if (!videoUrl) {
            try {
                const r = await api.youtube(video.url, 'video');
                videoUrl = r?.url;
            } catch (e) {
                errors.push('fallback: ' + (e.details ? e.details.join(' | ') : e.message));
            }
        }

        if (!videoUrl) throw new Error(errors.join(' || '));

        // Only the video itself - no preview, no extra messages
        await conn.sendMessage(from, {
            video: { url: videoUrl },
            mimetype: 'video/mp4',
            fileName: `${video.title}.mp4`
        }, { quoted: mek });

    } catch (err) {
        console.error('[video] failed ->', err.message);
        reply("Video download failed. Please try again.");
    }
});
