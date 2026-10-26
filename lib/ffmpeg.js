// Small ffmpeg helpers shared by the converter/sticker/reaction plugins.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

let bin = 'ffmpeg';
try { bin = require('@ffmpeg-installer/ffmpeg').path; } catch {}

async function run(input, inExt, outExt, args) {
  const id = crypto.randomBytes(6).toString('hex');
  const a = path.join(os.tmpdir(), `mb_${id}.${inExt}`);
  const b = path.join(os.tmpdir(), `mb_${id}.${outExt}`);
  await fs.promises.writeFile(a, input);
  try {
    await new Promise((res, rej) => execFile(bin, ['-y', '-i', a, ...args, b], { timeout: 60000 }, (e) => (e ? rej(e) : res())));
    return await fs.promises.readFile(b);
  } finally { fs.promises.unlink(a).catch(() => {}); fs.promises.unlink(b).catch(() => {}); }
}

module.exports = {
  toAudio: (buf, ext = 'mp4') => run(buf, ext, 'mp3', ['-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k']),
  toPTT: (buf, ext = 'mp4') => run(buf, ext, 'ogg', ['-vn', '-c:a', 'libopus', '-b:a', '64k', '-vbr', 'on', '-ar', '48000', '-ac', '1']),
  gifToMp4: (buf) => run(buf, 'gif', 'mp4', ['-movflags', 'faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']),
  videoToWebp: (buf) => run(buf, 'mp4', 'webp', ['-vcodec', 'libwebp', '-vf', "scale='min(320,iw)':-1:flags=lanczos,fps=15,pad=320:320:-1:-1:color=white@0.0", '-loop', '0', '-t', '8', '-an', '-vsync', '0']),
  webpToPng: (buf) => run(buf, 'webp', 'png', [])
};
