const axios = require('axios');
const yts = require('yt-search');

module.exports = {
    cmd: "play",
    alias: ["audio", "song"],
    desc: "Download songs from YouTube",
    category: "download",

    async execute(conn, m, { text }) {
        if (!text) {
            return m.reply("Usage: .play song name");
        }

        const DL_API = 'https://api.qasimdev.dpdns.org/api/loaderto/download';
        const API_KEY = 'xbps-install-Syu';

        try {
            const query = text.trim();
            let video;

            if (
                query.includes('youtube.com') ||
                query.includes('youtu.be')
            ) {
                video = { url: query, title: 'FREEZER MD Song' };
            } else {
                const search = await yts(query);
                video = search.videos[0];
            }

            if (!video) {
                return m.reply("Song not found.");
            }

            const { data } = await axios.get(DL_API, {
                params: {
                    apiKey: API_KEY,
                    format: 'mp3',
                    url: video.url
                },
                timeout: 90000
            });

            const audioUrl = data?.data?.downloadUrl;

            if (!audioUrl) {
                throw new Error('Audio download link unavailable.');
            }

            await conn.sendMessage(
                m.from,
                {
                    audio: { url: audioUrl },
                    mimetype: 'audio/mpeg',
                    fileName: `${video.title}.mp3`,
                    ptt: false
                },
                { quoted: m }
            );

            await m.react("✅");

        } catch (err) {
            console.error('FREEZER MD Play Error:', err.message);
            await m.reply("Song download failed. Please try again.");
        }
    }
};
