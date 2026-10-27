'use strict';
/**
 * Central place for every outside service the plugins talk to.
 *
 * Why this file exists: free public APIs die all the time. Instead of each plugin hard-coding
 * one URL, every feature here tries several providers in order (firstOf) and only fails when
 * ALL of them fail. When a provider dies, change/add ONE line here – not 20 plugins.
 *
 * Optional environment variables (put them in bot.env):
 *   ANTHROPIC_API_KEY / AI_MODEL          -> .ai/.gpt/.deepseek/.metaai answer via Claude
 *   OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL -> any OpenAI-compatible API
 *   UNSPLASH_KEY                          -> better .img results
 *   AUDD_API_TOKEN                        -> .music / .shazam (https://audd.io)
 *   YTDLP_PATH                            -> path of a yt-dlp binary (last-resort downloader)
 *   PRAYER_CITY, PRAYER_METHOD            -> defaults for .praytime
 */
const axios = require('axios');
const { execFile } = require('child_process');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const http = axios.create({ timeout: 25000, maxRedirects: 5, headers: { 'User-Agent': UA } });

function tryRequire(name) { try { return require(name); } catch { return null; } }
const abs = (u, base) => (!u ? u : /^https?:\/\//i.test(u) ? u : base + u);

/** attempts = [[name, async () => result|null], ...]  -> first truthy result wins */
async function firstOf(label, attempts) {
    const errors = [];
    for (const [name, fn] of attempts) {
        try {
            const r = await fn();
            if (r) return r;
            errors.push(`${name}: no data`);
        } catch (e) {
            errors.push(`${name}: ${e.response?.status || ''} ${e.message}`.replace(/\s+/g, ' ').trim());
        }
    }
    const err = new Error(`${label}: every provider failed`);
    err.details = errors;
    console.error(`[api] ${label} failed -> ${errors.join(' | ')}`);
    throw err;
}

/** Last-resort downloader. Works only if a yt-dlp binary exists (YTDLP_PATH or on PATH). */
function ytdlpUrl(url, format = 'best[ext=mp4]/best') {
    return new Promise((resolve, reject) => {
        execFile(process.env.YTDLP_PATH || 'yt-dlp', ['-g', '-f', format, '--no-playlist', '--no-warnings', url],
            { timeout: 45000, maxBuffer: 1024 * 1024 }, (err, out) => {
                if (err) return reject(err);
                const lines = String(out).split('\n').map(s => s.trim()).filter(Boolean);
                lines.length ? resolve(lines) : reject(new Error('yt-dlp returned nothing'));
            });
    });
}

// ───────────────────────────── DOWNLOADERS ─────────────────────────────

/** -> { title, author, video, audio, cover } */
async function tiktok(url) {
    return firstOf('TikTok download', [
        ['tikwm', async () => {
            const { data } = await http.get('https://www.tikwm.com/api/', { params: { url, hd: 1 } });
            const d = data?.data;
            if (!d || data.code !== 0) return null;
            const B = 'https://www.tikwm.com';
            const video = abs(d.hdplay || d.play, B);
            return video && { title: d.title, author: d.author?.nickname || d.author?.unique_id, video, audio: abs(d.music, B), cover: abs(d.cover, B) };
        }],
        ['tiklydown', async () => {
            const { data } = await http.get('https://api.tiklydown.eu.org/api/download/v3', { params: { url } });
            const r = data?.result || data;
            const video = r?.video?.noWatermark || r?.video_data?.nwm_video_url_HQ || r?.video_data?.nwm_video_url;
            return video && { title: r?.description || r?.desc, author: r?.author?.nickname || r?.author?.name, video, audio: r?.music?.play_url, cover: r?.video?.cover };
        }],
        ['ruhend', async () => {
            const rs = tryRequire('ruhend-scraper');
            if (!rs?.ttdl) return null;
            const r = await rs.ttdl(url);
            return r?.video && { title: r.title, author: r.username || r.author, video: r.video, audio: r.music, cover: r.cover };
        }],
        ['yt-dlp', async () => { const u = await ytdlpUrl(url); return { title: 'TikTok video', author: '', video: u[0] }; }],
    ]);
}

/** -> [{ title, author, duration, url, thumbnail, views }] */
async function tiktokSearch(query, count = 7) {
    return firstOf('TikTok search', [
        ['tikwm', async () => {
            const { data } = await http.post('https://www.tikwm.com/api/feed/search',
                new URLSearchParams({ keywords: query, count: String(count), cursor: '0', web: '1', hd: '1' }).toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } });
            const list = data?.data?.videos;
            if (!Array.isArray(list) || !list.length) return null;
            const B = 'https://www.tikwm.com';
            return list.slice(0, count).map(v => ({
                title: v.title, author: v.author?.nickname || v.author?.unique_id, duration: v.duration,
                url: abs(v.hdplay || v.play, B), thumbnail: abs(v.cover, B), views: v.play_count,
                link: v.author?.unique_id ? `https://www.tiktok.com/@${v.author.unique_id}/video/${v.video_id}` : '',
            })).filter(v => v.url);
        }],
    ]);
}

/** -> [{ url, type: 'video'|'image' }] */
async function instagram(url) {
    const kind = u => (/\.(mp4|mov|webm)(\?|$)|video|\/o1\/v\//i.test(u) ? 'video' : 'image');
    return firstOf('Instagram download', [
        ['ruhend', async () => {
            const rs = tryRequire('ruhend-scraper');
            if (!rs?.igdl) return null;
            const r = await rs.igdl(url);
            const list = (r?.data || []).map(x => x.url).filter(Boolean);
            return list.length ? [...new Set(list)].map(u => ({ url: u, type: kind(u) })) : null;
        }],
        ['yt-dlp', async () => (await ytdlpUrl(url)).map(u => ({ url: u, type: kind(u) }))],
    ]);
}

/** -> { title, hd, sd, thumbnail } */
async function facebook(url) {
    const pick = arr => {
        if (!Array.isArray(arr) || !arr.length) return null;
        const hd = arr.find(x => /hd|720|1080/i.test(x.resolution || x.quality || ''))?.url;
        const sd = arr.find(x => /sd|360|480/i.test(x.resolution || x.quality || ''))?.url;
        const any = arr[0]?.url;
        return { hd: hd || any, sd: sd || any, thumbnail: arr[0]?.thumbnail, title: 'Facebook Video' };
    };
    return firstOf('Facebook download', [
        ['ruhend', async () => {
            const rs = tryRequire('ruhend-scraper');
            if (!rs?.fbdl) return null;
            const r = await rs.fbdl(url);
            return pick(r?.data || r?.result);
        }],
        ['fb-downloader', async () => {
            const lib = tryRequire('@xaviabot/fb-downloader');
            if (!lib) return null;
            const r = await lib(url);
            return (r?.hd || r?.sd) ? { title: r.title, hd: r.hd || r.sd, sd: r.sd || r.hd, thumbnail: r.thumbnail } : null;
        }],
        ['yt-dlp', async () => { const u = await ytdlpUrl(url); return { title: 'Facebook Video', hd: u[0], sd: u[0] }; }],
    ]);
}

/** First YouTube hit for a text query -> { title, url, timestamp, views, author, thumbnail } */
async function ytFind(query) {
    const yts = require('yt-search');
    const r = await yts(query);
    const v = r?.videos?.[0];
    return v && { title: v.title, url: v.url, timestamp: v.timestamp, views: v.views, author: v.author?.name, thumbnail: v.thumbnail };
}

/** kind: 'video' | 'audio' -> { title, url } */
async function youtube(url, kind = 'video') {
    const isAudio = kind === 'audio';
    return firstOf(`YouTube ${kind} download`, [
        ['ruhend', async () => {
            const rs = tryRequire('ruhend-scraper');
            const fn = isAudio ? rs?.ytmp3 : rs?.ytmp4;
            if (!fn) return null;
            const r = await fn(url);
            const link = isAudio ? (r?.audio || r?.url) : (r?.video || r?.url);
            return link && { title: r.title, url: link };
        }],
        ['gifted', async () => {
            const { data } = await http.get(`https://api.giftedtech.my.id/api/download/${isAudio ? 'ytmp3' : 'ytmp4'}`, { params: { apikey: 'gifted', url } });
            const link = data?.result?.download_url;
            return link && { title: data.result.title, url: link };
        }],
        ['yt-dlp', async () => {
            const u = await ytdlpUrl(url, isAudio ? 'bestaudio[ext=m4a]/bestaudio' : 'best[ext=mp4]/best');
            return { title: 'YouTube', url: u[0] };
        }],
    ]);
}

/** Pinterest pin (or pin.it short link) -> { title, video?, image? } by reading the page's own metadata. */
async function pinterest(url) {
    return firstOf('Pinterest download', [
        ['page', async () => {
            const { data: html } = await http.get(url, { headers: { 'Accept-Language': 'en-US,en;q=0.9' } });
            const s = String(html);
            const meta = p => s.match(new RegExp(`<meta[^>]+property=["']${p}["'][^>]+content=["']([^"']+)`, 'i'))?.[1];
            const video = s.match(/https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\\\s]+?\.mp4/i)?.[0];
            let image = meta('og:image');
            if (image) image = image.replace(/\/(\d+x|236x|474x|564x|736x)\//, '/originals/');
            const title = (meta('og:title') || 'Pinterest').replace(/&amp;/g, '&');
            return (video || image) ? { title, video, image } : null;
        }],
        ['yt-dlp', async () => { const u = await ytdlpUrl(url); return { title: 'Pinterest', video: u[0] }; }],
    ]);
}

// ───────────────────────────── AI ─────────────────────────────

/** Returns the AI's text answer. `model` is only a hint for providers that offer a choice. */
async function ai(prompt, { model, system } = {}) {
    const sys = system || 'You are a helpful WhatsApp assistant. Answer clearly and keep it reasonably short.';
    const attempts = [];

    if (process.env.ANTHROPIC_API_KEY) {
        attempts.push(['anthropic', async () => {
            const { data } = await http.post('https://api.anthropic.com/v1/messages', {
                model: process.env.AI_MODEL || 'claude-haiku-5-5', max_tokens: 1024, system: sys,
                messages: [{ role: 'user', content: prompt }],
            }, { timeout: 60000, headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } });
            return (data?.content || []).map(c => c.text || '').join('').trim();
        }]);
    }
    if (process.env.OPENAI_API_KEY) {
        attempts.push(['openai-compatible', async () => {
            const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
            const { data } = await http.post(`${base}/chat/completions`, {
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }],
            }, { timeout: 60000, headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } });
            return data?.choices?.[0]?.message?.content?.trim();
        }]);
    }
    // Free, no key. Quality/availability varies, so they are only the fallback.
    attempts.push(['pollinations-chat', async () => {
        const { data } = await http.post('https://text.pollinations.ai/openai', {
            model: model || 'openai',
            messages: [{ role: 'system', content: sys }, { role: 'user', content: prompt }],
        }, { timeout: 60000 });
        return data?.choices?.[0]?.message?.content?.trim();
    }]);
    attempts.push(['pollinations-get', async () => {
        const { data } = await http.get(`https://text.pollinations.ai/${encodeURIComponent(prompt)}`, { params: { system: sys }, timeout: 60000, responseType: 'text' });
        return typeof data === 'string' ? data.trim() : null;
    }]);
    return firstOf('AI chat', attempts);
}

// ───────────────────────────── INFO / TOOLS ─────────────────────────────

/** Prayer times via AlAdhan (free, no key, stable). */
async function prayer(city) {
    const { data } = await http.get('https://api.aladhan.com/v1/timingsByAddress', { params: { address: city, method: process.env.PRAYER_METHOD || 2 } });
    const d = data?.data;
    if (!d?.timings) throw new Error('City not found');
    let qibla = null;
    try {
        const q = await http.get(`https://api.aladhan.com/v1/qibla/${d.meta.latitude}/${d.meta.longitude}`);
        qibla = q.data?.data?.direction;
    } catch { /* optional */ }
    return { timings: d.timings, meta: d.meta, date: d.date, qibla };
}

const decodeXml = s => String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ').trim();

/** Top headlines from public RSS feeds (no API key). */
async function news(count = 5) {
    const feeds = [
        ['bbc', 'https://feeds.bbci.co.uk/news/rss.xml'],
        ['aljazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
        ['npr', 'https://feeds.npr.org/1001/rss.xml'],
    ];
    return firstOf('News', feeds.map(([name, url]) => [name, async () => {
        const { data } = await http.get(url, { responseType: 'text' });
        const items = [...String(data).matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].slice(0, count).map(m => {
            const b = m[1];
            const tag = t => decodeXml(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))?.[1]);
            let image = b.match(/<media:(?:thumbnail|content)[^>]*url=["']([^"']+)/i)?.[1] || b.match(/<enclosure[^>]*url=["']([^"']+)/i)?.[1];
            if (image) image = image.replace('/standard/240/', '/standard/976/');
            return { title: tag('title'), description: tag('description'), url: tag('link'), image, source: name };
        }).filter(i => i.title);
        return items.length ? items : null;
    }]));
}

/** Movie / series search through IMDb's public suggestion endpoint. -> [{ id, title, year, type, stars, poster }] */
async function movieSearch(query) {
    const first = /[a-z0-9]/i.test(query[0] || '') ? query[0].toLowerCase() : 'x';
    return firstOf('Movie search', ['v3', 'v2'].map(v => [`imdb-${v}`, async () => {
        const { data } = await http.get(`https://${v}.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(query)}.json`);
        const list = (data?.d || []).filter(x => /^tt/.test(x.id || '')).map(x => ({
            id: x.id, title: x.l, year: x.y, type: x.q || x.qid, stars: x.s, poster: x.i?.imageUrl, rank: x.rank,
        }));
        return list.length ? list : null;
    }]));
}

/** Extra details (rating, plot, genres). Optional: returns null if the service is down. */
async function movieDetails(id) {
    try {
        const { data } = await http.get(`https://api.imdbapi.dev/titles/${id}`, { timeout: 12000 });
        return {
            rating: data?.rating?.aggregateRating, votes: data?.rating?.voteCount, plot: data?.plot,
            genres: data?.genres, runtime: data?.runtimeSeconds ? Math.round(data.runtimeSeconds / 60) : null,
            poster: data?.primaryImage?.url,
        };
    } catch { return null; }
}

/** Image search -> [{ url, title }] (Unsplash if you set UNSPLASH_KEY, otherwise Wikimedia Commons then Openverse). */
async function images(query, count = 3) {
    const attempts = [];
    if (process.env.UNSPLASH_KEY) {
        attempts.push(['unsplash', async () => {
            const { data } = await http.get('https://api.unsplash.com/search/photos', { params: { query, per_page: 30, client_id: process.env.UNSPLASH_KEY } });
            return (data?.results || []).map(r => ({ url: r.urls?.regular, title: r.alt_description })).filter(r => r.url);
        }]);
    }
    attempts.push(['wikimedia', async () => {
        const { data } = await http.get('https://commons.wikimedia.org/w/api.php', {
            params: {
                action: 'query', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: 6, gsrlimit: 40,
                prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: 1080, format: 'json', origin: '*',
            },
        });
        return Object.values(data?.query?.pages || {})
            .map(p => ({ ii: p.imageinfo?.[0], title: (p.title || '').replace(/^File:/, '') }))
            .filter(x => x.ii && /image\/(jpeg|png)/.test(x.ii.mime))
            .map(x => ({ url: x.ii.thumburl || x.ii.url, title: x.title }));
    }]);
    attempts.push(['openverse', async () => {
        const { data } = await http.get('https://api.openverse.org/v1/images/', { params: { q: query, page_size: 30, mature: false } });
        return (data?.results || []).map(r => ({ url: r.thumbnail || r.url, title: r.title })).filter(r => r.url);
    }]);

    const all = await firstOf('Image search', attempts.map(([n, f]) => [n, async () => { const r = await f(); return r?.length ? r : null; }]));
    return all.sort(() => Math.random() - 0.5).slice(0, count);
}

/** Search & resolve an APK through Aptoide's public API. -> { name, package, version, size, url, icon } */
async function apk(query) {
    return firstOf('APK search', [['aptoide', async () => {
        const { data } = await http.get(`https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`);
        const a = data?.datalist?.list?.[0];
        const url = a?.file?.path || a?.file?.path_alt;
        return url && { name: a.name, package: a.package, version: a.file?.vername, size: a.size || a.file?.filesize, url, icon: a.icon };
    }]]);
}

/** Identify a song from a public audio URL (needs AUDD_API_TOKEN from https://audd.io). */
async function whatMusic(audioUrl) {
    if (!process.env.AUDD_API_TOKEN) {
        const e = new Error('MUSIC_NOT_CONFIGURED');
        e.code = 'NOT_CONFIGURED';
        throw e;
    }
    const { data } = await http.post('https://api.audd.io/', new URLSearchParams({ api_token: process.env.AUDD_API_TOKEN, url: audioUrl, return: 'apple_music,spotify' }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 40000 });
    const r = data?.result;
    if (!r) return null;
    return { title: r.title, artist: r.artist, album: r.album, released: r.release_date, link: r.song_link };
}

/** Upload a Buffer to catbox.moe -> public URL */
async function uploadCatbox(buffer, filename = 'file.bin') {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, filename);
    const { data } = await http.post('https://catbox.moe/user/api.php', form, { headers: form.getHeaders(), timeout: 60000, maxBodyLength: Infinity });
    if (!/^https?:\/\//.test(String(data))) throw new Error('upload failed');
    return String(data).trim();
}

module.exports = {
    http, firstOf, tryRequire, ytdlpUrl,
    tiktok, tiktokSearch, instagram, facebook, ytFind, youtube, pinterest,
    ai, prayer, news, movieSearch, movieDetails, images, apk, whatMusic, uploadCatbox,
};
