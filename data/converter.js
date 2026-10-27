'use strict';
// Used by plugins/tool-converter.js
const { run } = require('../lib/ffmpeg-run');

/** any audio/video -> mp3 */
const toAudio = (buffer, ext = 'mp4') => run(buffer, ext, 'mp3', c => c.noVideo().audioCodec('libmp3lame').audioBitrate('128k').audioChannels(2));
/** any audio/video -> WhatsApp voice note (ogg/opus) */
const toPTT = (buffer, ext = 'mp4') => run(buffer, ext, 'ogg', c => c.noVideo().audioCodec('libopus').audioBitrate('64k').audioChannels(1).outputOptions(['-avoid_negative_ts', 'make_zero']));

module.exports = { toAudio, toPTT };
