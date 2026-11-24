// Giphy: a GIF's small copy or still as the full-size video.
addSite({
  name: 'Giphy',
  larger: [
    // Copies are named by size (200w.webp, 100.webp, 200w_s.gif for the still) beside giphy.mp4, the full-size
    // video. giphy.gif and giphy.webp are full size already.
    [
      /^(https?:\/\/(?:media\d*|i)\.giphy\.com\/media\/(?:v1\.[^/?#]+\/)?\w+\/)(?!giphy\.)[\w-]+\.(?:gif|webp)(?:[?#].*)?$/,
      '$1giphy.mp4',
    ],
  ],
  // Every GIF's files have the same names, giphy.mp4 and the like, so a saved one is named after the GIF's id.
  fileName(url) {
    const found = /^https?:\/\/(?:media\d*|i)\.giphy\.com\/media\/(?:v1\.[^/?#]+\/)?(\w+)\/[\w-]+\.(gif|webp|mp4)(?:[?#]|$)/.exec(url);
    return found ? found[1] + '.' + found[2] : '';
  },
});
