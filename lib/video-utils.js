const ff = require('./ffmpeg');
module.exports = { videoToWebp: (b) => ff.videoToWebp(Buffer.from(b)) };
