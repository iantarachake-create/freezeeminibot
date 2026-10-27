'use strict';
// Small helper: run ffmpeg on a buffer and get a buffer back, cleaning up temp files.
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');
const crypto = require('crypto');
const ffmpeg = require('fluent-ffmpeg');
try { ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path); } catch { /* use system ffmpeg */ }

const tmp = ext => path.join(tmpdir(), `${crypto.randomBytes(6).toString('hex')}.${ext}`);

async function run(inputBuffer, inExt, outExt, configure) {
    const inFile = tmp(inExt), outFile = tmp(outExt);
    fs.writeFileSync(inFile, inputBuffer);
    try {
        await new Promise((resolve, reject) => {
            const cmd = ffmpeg(inFile).on('error', reject).on('end', resolve);
            configure(cmd);
            cmd.save(outFile);
        });
        return fs.readFileSync(outFile);
    } finally {
        for (const f of [inFile, outFile]) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    }
}
module.exports = { run };
