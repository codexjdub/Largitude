// YouTube: a video's largest still, for its thumbnails and links to it on other sites. On YouTube itself, a
// thumbnail plays a preview of its own when the mouse rests on it, so YouTube's thumbnails and links to its
// videos are left to it there.
(() => {
  // A still: i.ytimg.com/vi/<id>/hqdefault.jpg, or vi_webp/<id>/….webp, on any of YouTube's image hosts.
  const STILL = /^https?:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\/vi(?:_webp)?\/([\w-]{11})\/[\w-]+\.(?:jpg|webp)(?:[?#].*)?$/;
  // A link to a video: youtube.com/watch?v=<id>, youtu.be/<id>, youtube.com/shorts/<id> and the like.
  const VIDEO =
    /^https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{11})(?:[?&#/].*)?$/;
  // The stills are named by size: maxresdefault (1280 px wide), which older and smaller videos don't have, then
  // sddefault (640) and hqdefault (480), which every video has.
  const SIZES = ['maxresdefault', 'sddefault', 'hqdefault'];

  addSite({
    name: 'YouTube',
    larger: [STILL, VIDEO].flatMap((find) => SIZES.map((size) => [find, `https://i.ytimg.com/vi/$1/${size}.jpg`])),
    // A size the video doesn't have comes as a gray 120 × 90 image, not an error.
    standIn: (url, size) => STILL.test(url) && size.width === 120 && size.height === 90,
    leaveAlone: (url, pageUrl) =>
      /^https?:\/\/(?:[\w-]+\.)?youtube(?:-nocookie)?\.com\//.test(pageUrl) && (STILL.test(url) || VIDEO.test(url)),
  });
})();
