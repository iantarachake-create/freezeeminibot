'use strict';
// Used by plugins/reactions.js: download a GIF and turn it into an mp4 WhatsApp plays as a GIF.
const { fetchGif } = require('./sticker-utils');
const { run } = require('./ffmpeg-run');

async function gifToVideo(gifBuffer) {
    return run(gifBuffer, 'gif', 'mp4', c => c.outputOptions([
        '-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-an',
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    ]));
}
module.exports = { fetchGif, gifToVideo };
