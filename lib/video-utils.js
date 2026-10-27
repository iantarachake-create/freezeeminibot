'use strict';
// Used by plugins/tool-sticker.js: video/GIF buffer -> animated WebP (max 8 s, 512x512).
const { run } = require('./ffmpeg-run');

async function videoToWebp(buffer) {
    return run(buffer, 'mp4', 'webp', c => c.outputOptions([
        '-vcodec', 'libwebp', '-t', '8', '-loop', '0', '-an', '-vsync', '0',
        '-vf', "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease,fps=15,pad=512:512:-1:-1:color=white@0.0",
        '-preset', 'default',
    ]));
}
module.exports = { videoToWebp };
