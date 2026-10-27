'use strict';
// Used by plugins/tool-converter.js: sticker (webp) -> png
async function convertStickerToImage(buffer) {
    try {
        return await require('sharp')(buffer).png().toBuffer();
    } catch (e) {
        const { run } = require('../lib/ffmpeg-run');
        return run(buffer, 'webp', 'png', c => c.frames(1));
    }
}
module.exports = { convertStickerToImage };
