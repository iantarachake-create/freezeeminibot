const axios = require('axios');
const ff = require('./ffmpeg');
const fetchGif = async (url) => (await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 })).data;
const gifToVideo = (buf) => ff.gifToMp4(Buffer.from(buf));
module.exports = { fetchGif, gifToVideo };
