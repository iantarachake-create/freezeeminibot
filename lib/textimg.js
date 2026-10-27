'use strict';
/**
 * Local text-effect renderer – replaces the dead "ephoto360" web APIs used by the logo commands and .attp.
 * No network: text is converted to vector paths with a bundled font (assets/fonts, OFL licence) via opentype.js,
 * dressed up as an SVG (gradients, glow, 3D extrusion …) and rasterised with sharp.
 * Because the glyphs are drawn as paths, it does NOT depend on fonts installed on the server.
 */
const path = require('path');

let _font = null;
function getFont() {
    if (!_font) _font = require('opentype.js').loadSync(path.join(__dirname, '..', 'assets', 'fonts', 'Poppins-Bold.ttf'));
    return _font;
}
const _setFont = f => { _font = f; };          // test hook

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// tiny deterministic random generator so the same text always gives the same decoration
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ───────────── text layout ─────────────
function balance(words, n) {
    if (n <= 1) return [words.join(' ')];
    const total = words.join(' ').length, target = total / n, lines = [];
    let cur = [];
    for (const w of words) {
        cur.push(w);
        if (cur.join(' ').length >= target && lines.length < n - 1) { lines.push(cur.join(' ')); cur = []; }
    }
    if (cur.length) lines.push(cur.join(' '));
    return lines;
}

function layout(text, W, H, o = {}) {
    const font = getFont();
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) words.push(' ');
    const padX = W * (o.padX ?? 0.07), padY = H * (o.padY ?? 0.14);
    let best = null;
    for (let n = 1; n <= Math.min(o.maxLines || 3, words.length); n++) {
        const lines = balance(words, n);
        let size = o.maxSize || 230;
        while (size > 12) {
            const widest = Math.max(...lines.map(l => font.getAdvanceWidth(l, size)));
            if (widest <= W - 2 * padX && lines.length * size * 1.18 <= H - 2 * padY) break;
            size -= 4;
        }
        if (!best || size > best.size) best = { lines, size };
    }
    return best;
}

/** -> { id, defs } where defs is <g id=..> holding the glyph paths centred in a W×H box */
function makeText(text, W, H, o = {}, id = 't') {
    const font = getFont();
    const { lines, size } = layout(text, W, H, o);
    const lh = size * 1.18, top = (H - lines.length * lh) / 2;
    const paths = lines.map((l, i) => {
        const w = font.getAdvanceWidth(l, size);
        return `<path d="${font.getPath(l, (W - w) / 2, top + i * lh + lh / 2 + size * 0.36, size).toPathData(2)}"/>`;
    });
    return { id, size, defs: `<g id="${id}">${paths.join('')}</g>` };
}

// ───────────── building blocks ─────────────
const use = (id, a = '') => `<use xlink:href="#${id}" ${a}/>`;
const blur = (id, sd) => `<filter id="${id}" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const lg = (id, stops, vertical = true) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="${vertical ? 1 : 0}">${stops.map((c, i) => `<stop offset="${(i / Math.max(1, stops.length - 1) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('')}</linearGradient>`;
const hardBands = (id, colors) => {      // gradient with hard edges (flag colours)
    const n = colors.length;
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${colors.map((c, i) => `<stop offset="${(i / n * 100).toFixed(1)}%" stop-color="${c}"/><stop offset="${((i + 1) / n * 100).toFixed(1)}%" stop-color="${c}"/>`).join('')}</linearGradient>`;
};

function background(W, H, bg) {
    if (!bg) return '';
    if (typeof bg === 'string') return `<rect width="${W}" height="${H}" fill="${bg}"/>`;
    return `<defs>${lg('bgg', bg)}</defs><rect width="${W}" height="${H}" fill="url(#bgg)"/>`;
}

function decoration(kind, W, H, seed) {
    const r = rng(seed);
    let out = '';
    if (kind === 'stars') {
        for (let i = 0; i < 110; i++) out += `<circle cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" r="${(0.5 + r() * 2).toFixed(1)}" fill="#fff" opacity="${(0.35 + r() * 0.65).toFixed(2)}"/>`;
    } else if (kind === 'confetti') {
        const cols = ['#ff4d6d', '#ffd23f', '#3bceac', '#4cc9f0', '#b5179e', '#fb8500'];
        for (let i = 0; i < 60; i++) out += `<rect x="${(r() * W).toFixed(0)}" y="${(r() * H).toFixed(0)}" width="${(8 + r() * 10).toFixed(0)}" height="${(5 + r() * 8).toFixed(0)}" fill="${cols[i % cols.length]}" transform="rotate(${(r() * 360).toFixed(0)} ${(r() * W).toFixed(0)} ${(r() * H).toFixed(0)})" opacity=".85"/>`;
    } else if (kind === 'clouds') {
        out += `<defs>${blur('cl', 22)}</defs>`;
        for (let i = 0; i < 7; i++) out += `<ellipse cx="${(r() * W).toFixed(0)}" cy="${(r() * H).toFixed(0)}" rx="${(120 + r() * 160).toFixed(0)}" ry="${(40 + r() * 50).toFixed(0)}" fill="#fff" opacity=".75" filter="url(#cl)"/>`;
    } else if (kind === 'sun') {
        out += `<defs>${blur('sn', 6)}</defs><circle cx="${W / 2}" cy="${H * 0.78}" r="${H * 0.3}" fill="#ffd166" opacity=".9" filter="url(#sn)"/>`;
    } else if (kind === 'burst') {
        const cx = W / 2, cy = H / 2, pts = [];
        for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2, rad = (i % 2 ? 0.42 : 0.62) * H * 1.15; pts.push(`${(cx + Math.cos(a) * rad * 1.6).toFixed(0)},${(cy + Math.sin(a) * rad).toFixed(0)}`); }
        out += `<polygon points="${pts.join(' ')}" fill="#ffd23f" stroke="#111" stroke-width="8"/>`;
    } else if (kind === 'scanlines') {
        out += `<defs><pattern id="sc" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="2" fill="#000" opacity=".28"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#sc)"/>`;
    }
    return out;
}

// ───────────── styles: (T = makeText result, W, H, o) -> { defs, body } ─────────────
const S = {
    neon: (T, W, H, o) => ({
        defs: blur('b14', 14) + blur('b5', 5),
        body: use(T.id, `fill="none" stroke="${o.colors[0]}" stroke-width="16" stroke-linejoin="round" filter="url(#b14)" opacity=".9"`)
            + use(T.id, `fill="none" stroke="${o.colors[0]}" stroke-width="8" stroke-linejoin="round" filter="url(#b5)"`)
            + use(T.id, `fill="${o.colors[1] || '#fff'}" stroke="${o.colors[0]}" stroke-width="2.5" stroke-linejoin="round"`),
    }),
    gradient: (T, W, H, o) => ({
        defs: lg('fg', o.colors) + blur('b8', 8),
        body: use(T.id, `fill="#000" opacity=".45" transform="translate(6,9)" filter="url(#b8)"`)
            + use(T.id, `fill="url(#fg)" stroke="${o.stroke || 'none'}" stroke-width="${o.stroke ? 4 : 0}" stroke-linejoin="round"`),
    }),
    extrude: (T, W, H, o) => {
        const depth = o.depth || 18; let layers = '';
        for (let i = depth; i >= 1; i--) layers += use(T.id, `fill="${o.side}" transform="translate(${i},${i})"`);
        return {
            defs: (o.bands ? hardBands('fg', o.colors) : lg('fg', o.colors || [o.face, o.face])) + blur('b8', 9),
            body: use(T.id, `fill="#000" opacity=".4" transform="translate(${depth + 4},${depth + 10})" filter="url(#b8)"`) + layers
                + use(T.id, `fill="url(#fg)" stroke="${o.stroke || 'none'}" stroke-width="${o.stroke ? 3 : 0}" stroke-linejoin="round"`),
        };
    },
    outline: (T, W, H, o) => ({
        defs: '',
        body: use(T.id, `fill="none" stroke="${o.stroke}" stroke-width="${o.sw || 14}" stroke-linejoin="round" transform="translate(5,6)" opacity=".5"`)
            + use(T.id, `fill="none" stroke="${o.stroke}" stroke-width="${o.sw || 14}" stroke-linejoin="round"`)
            + use(T.id, `fill="${o.face}"`),
    }),
    comic: (T, W, H, o) => ({
        defs: '',
        body: use(T.id, `fill="#000" transform="translate(12,12)"`)
            + use(T.id, `fill="none" stroke="#000" stroke-width="18" stroke-linejoin="round"`)
            + use(T.id, `fill="${o.face || '#ffd23f'}" stroke="${o.stroke || '#e63946'}" stroke-width="4" stroke-linejoin="round"`),
    }),
    glitch: (T, W, H, o) => ({
        defs: '',
        body: use(T.id, `fill="${o.colors[0]}" transform="translate(-8,0)" opacity=".85"`)
            + use(T.id, `fill="${o.colors[1]}" transform="translate(8,0)" opacity=".85"`)
            + use(T.id, `fill="#fff"`),
    }),
    sticker: (T, W, H, o) => ({
        defs: '',
        body: use(T.id, `fill="none" stroke="#fff" stroke-width="${o.sw || 26}" stroke-linejoin="round" stroke-linecap="round"`)
            + use(T.id, `fill="${o.face}" stroke="#222" stroke-width="3" stroke-linejoin="round"`),
    }),
    dotted: (T, W, H, o) => ({           // light-bulb marquee look
        defs: blur('b12', 12),
        body: use(T.id, `fill="none" stroke="${o.colors[0]}" stroke-width="22" stroke-linecap="round" stroke-dasharray="0 26" filter="url(#b12)" opacity=".9"`)
            + use(T.id, `fill="none" stroke="${o.colors[1] || '#fff7c2'}" stroke-width="12" stroke-linecap="round" stroke-dasharray="0 26"`)
            + use(T.id, `fill="none" stroke="${o.colors[0]}" stroke-width="2"`),
    }),
    erased: (T, W, H, o) => ({
        defs: '',
        body: use(T.id, `fill="none" stroke="${o.stroke || '#fff'}" stroke-width="5" stroke-linejoin="round" stroke-dasharray="26 10"`)
            + use(T.id, `fill="${o.face || '#ffffff'}" opacity=".12"`),
    }),
};

// ───────────── presets (one per logo command) ─────────────
const P = {
    '3dcomic': { style: 'comic', bg: ['#2b2d42', '#8d99ae'], deco: 'burst', face: '#ffd23f', stroke: '#e63946' },
    dragonball: { style: 'extrude', bg: ['#4cc9f0', '#f8f9fa'], deco: 'clouds', face: '#ff9f1c', colors: ['#ffd166', '#ff7b00'], side: '#9c3d00', stroke: '#fff3b0' },
    deadpool: { style: 'outline', bg: ['#c1121f', '#1a0000'], face: '#ffffff', stroke: '#000', sw: 16 },
    blackpink: { style: 'neon', bg: '#0b0b0f', colors: ['#ff2d95', '#ffe3f1'] },
    neonlight: { style: 'neon', bg: ['#0a0a23', '#1b0a3a'], colors: ['#00f5ff', '#ffffff'] },
    cat: { style: 'outline', bg: ['#ffe5ec', '#ffc2d1'], face: '#ff8fab', stroke: '#fff', sw: 18 },
    sadgirl: { style: 'gradient', bg: ['#1b263b', '#415a77'], colors: ['#e0e1dd', '#a9d6e5'], deco: 'stars' },
    naruto: { style: 'outline', bg: ['#ff9f1c', '#e85d04'], face: '#1d3557', stroke: '#fff', sw: 14 },
    thor: { style: 'neon', bg: ['#0d1b2a', '#1b263b'], colors: ['#ffe066', '#ffffff'], deco: 'stars' },
    america: { style: 'extrude', bg: ['#0a1f44', '#1d3557'], colors: ['#d90429', '#ffffff', '#2b59c3'], bands: true, face: '#fff', side: '#6b0f1a', deco: 'stars' },
    eraser: { style: 'erased', bg: '#14213d', stroke: '#ffffff', face: '#ffffff' },
    '3dpaper': { style: 'extrude', bg: ['#fff1e6', '#ffd6e0'], colors: ['#ffffff', '#ffd6e0'], face: '#fff', side: '#ff8fab', depth: 14 },
    futuristic: { style: 'glitch', bg: ['#050816', '#0b1d51'], colors: ['#ff0054', '#00f5d4'], deco: 'scanlines' },
    clouds: { style: 'gradient', bg: ['#74c0fc', '#e7f5ff'], colors: ['#ffffff', '#dbeafe'], deco: 'clouds' },
    sans: { style: 'neon', bg: '#000', colors: ['#3a86ff', '#ffffff'] },
    galaxy: { style: 'gradient', bg: ['#0b0033', '#370031'], colors: ['#8ecae6', '#e0aaff', '#ff70a6'], deco: 'stars' },
    leaf: { style: 'gradient', bg: ['#0b3d0b', '#1b5e20'], colors: ['#d8f3dc', '#52b788'], stroke: '#081c15' },
    sunset: { style: 'gradient', bg: ['#ff7b00', '#7b2cbf'], colors: ['#fff3b0', '#ff9e00', '#ff0054'], deco: 'sun' },
    nigeria: { style: 'extrude', bg: ['#ffffff', '#e8f5e9'], colors: ['#008751', '#ffffff', '#008751'], bands: true, face: '#008751', side: '#004d2c', stroke: '#004d2c' },
    devilwings: { style: 'neon', bg: ['#1a0000', '#000'], colors: ['#ff1f1f', '#ffd6d6'] },
    hacker: { style: 'neon', bg: '#020a02', colors: ['#00ff41', '#caffd6'], deco: 'scanlines' },
    boom: { style: 'comic', bg: ['#ff006e', '#8338ec'], deco: 'burst', face: '#fff', stroke: '#ff006e' },
    luxury: { style: 'extrude', bg: ['#050505', '#1c1c1c'], colors: ['#fff1b8', '#d4af37', '#8a6d1d'], face: '#d4af37', side: '#5c4710', depth: 10 },
    zodiac: { style: 'gradient', bg: ['#10002b', '#240046'], colors: ['#c77dff', '#e0aaff', '#ffffff'], deco: 'stars' },
    angelwings: { style: 'neon', bg: ['#a2d2ff', '#ffffff'], colors: ['#ffffff', '#ffffff'], deco: 'clouds' },
    bulb: { style: 'dotted', bg: '#120c06', colors: ['#ffb703', '#fff7c2'] },
    tatoo: { style: 'outline', bg: ['#f1d9c0', '#e0b896'], face: '#1b1b1b', stroke: '#3a2a1a', sw: 6 },
    castle: { style: 'extrude', bg: ['#5a189a', '#ff9e00'], colors: ['#ffffff', '#cdb4db'], face: '#fff', side: '#3c096c', deco: 'stars' },
    frozen: { style: 'gradient', bg: ['#0b3954', '#bfd7ea'], colors: ['#ffffff', '#bde0fe', '#4cc9f0'], stroke: '#ffffff', deco: 'stars' },
    paint: { style: 'gradient', bg: '#ffffff', colors: ['#ef476f', '#ffd166', '#06d6a0', '#118ab2'], stroke: '#222' },
    birthday: { style: 'extrude', bg: ['#ffe5f1', '#fff1c1'], colors: ['#ff4d6d', '#ffb703'], face: '#ff4d6d', side: '#9d0208', deco: 'confetti', depth: 12 },
    typography: { style: 'gradient', bg: ['#003049', '#005f73'], colors: ['#ccff33', '#06d6a0'], stroke: '#001d2b' },
    bear: { style: 'extrude', bg: ['#fff3e0', '#ffe0b2'], colors: ['#c68642', '#8d5524'], face: '#c68642', side: '#4e2c0e', depth: 14 },
};

// ───────────── public API ─────────────
function assemble(W, H, bg, deco, seed, defs, body, textDefs) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
        + `<defs>${defs || ''}${textDefs}</defs>${background(W, H, bg)}${decoration(deco, W, H, seed)}${body}</svg>`;
}
const hash = s => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

/** SVG source of a styled logo (exported for tests) */
function logoSvg(name, text, W = 1280, H = 640) {
    const p = P[name];
    if (!p) throw new Error(`unknown logo style ${name}`);
    const T = makeText(text, W, H, { maxLines: 3 });
    const st = S[p.style](T, W, H, p);
    return assemble(W, H, p.bg, p.deco, hash(text), st.defs, st.body, T.defs);
}

/** Badge style: "Word" + "Word" in a coloured rounded box (the classic two-tone logo). */
function badgeSvg(text, W = 1280, H = 640) {
    const font = getFont();
    const words = String(text).trim().split(/\s+/);
    let left, right;
    if (words.length === 1) { const w = words[0], k = Math.ceil(w.length / 2); left = w.slice(0, k); right = w.slice(k) || ' '; }
    else { right = words.pop(); left = words.join(' '); }
    let size = 200;
    const width = s => font.getAdvanceWidth(left, s) + font.getAdvanceWidth(right, s) + s * 0.55;
    while (size > 14 && width(size) > W * 0.88) size -= 4;
    const lw = font.getAdvanceWidth(left, size), rw = font.getAdvanceWidth(right, size), padX = size * 0.22;
    const total = lw + rw + padX * 2 + size * 0.15, x0 = (W - total) / 2, base = H / 2 + size * 0.36;
    const boxX = x0 + lw + size * 0.15, boxY = base - size * 0.82, boxH = size * 1.12;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#000"/>`
        + `<path fill="#fff" d="${font.getPath(left, x0, base, size).toPathData(2)}"/>`
        + `<rect x="${boxX}" y="${boxY}" width="${rw + padX * 2}" height="${boxH}" rx="${size * 0.14}" fill="#ff9900"/>`
        + `<path fill="#000" d="${font.getPath(right, boxX + padX, base, size).toPathData(2)}"/></svg>`;
}

/** Valorant-style 3-line banner */
function bannerSvg(t1, t2, t3, W = 1280, H = 720) {
    const a = makeText(t1, W, H * 0.2, { maxLines: 1, maxSize: 90 }, 'ta');
    const b = makeText(t2, W, H * 0.45, { maxLines: 2, maxSize: 260 }, 'tb');
    const c = makeText(t3, W, H * 0.2, { maxLines: 1, maxSize: 90 }, 'tc');
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
        + `<defs>${lg('bgv', ['#1a0a0f', '#3a0d1a', '#12060a'])}${blur('bv', 10)}${a.defs}${b.defs}${c.defs}</defs>`
        + `<rect width="${W}" height="${H}" fill="url(#bgv)"/>`
        + `<polygon points="0,${H * 0.82} ${W},${H * 0.55} ${W},${H} 0,${H}" fill="#ff4655" opacity=".9"/>`
        + `<polygon points="0,0 ${W * 0.35},0 0,${H * 0.3}" fill="#ff4655" opacity=".35"/>`
        + `<g transform="translate(0,${H * 0.08})">${use('ta', 'fill="#ece8e1"')}</g>`
        + `<g transform="translate(0,${H * 0.28})">${use('tb', 'fill="#ff4655" filter="url(#bv)" opacity=".6"')}${use('tb', 'fill="#ece8e1"')}</g>`
        + `<g transform="translate(0,${H * 0.72})">${use('tc', 'fill="#0f1923"')}</g></svg>`;
}

/** ATTP-style sticker: bold coloured text with white outline, transparent background, 512×512 */
function stickerSvg(text, W = 512, H = 512) {
    const palette = ['#ff4d6d', '#ffb703', '#06d6a0', '#4cc9f0', '#b5179e', '#fb8500', '#8ac926', '#1982c4'];
    const T = makeText(text, W, H, { maxLines: 4, maxSize: 200, padX: 0.08, padY: 0.1 });
    const face = palette[hash(text) % palette.length];
    const st = S.sticker(T, W, H, { face, sw: 22 });
    return assemble(W, H, null, null, 1, st.defs, st.body, T.defs);
}

async function toPng(svg) { return require('sharp')(Buffer.from(svg)).png().toBuffer(); }

async function logo(name, text) { return toPng(logoSvg(name, text)); }
async function badge(text) { return toPng(badgeSvg(text)); }
async function banner(a, b, c) { return toPng(bannerSvg(a, b, c)); }
async function sticker(text) { return require('sharp')(Buffer.from(stickerSvg(text))).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toBuffer(); }

module.exports = { presets: Object.keys(P), logo, badge, banner, sticker, logoSvg, badgeSvg, bannerSvg, stickerSvg, _setFont, _esc: esc };
