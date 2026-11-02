// Reddit: the original uploads behind its copies, its galleries, and its videos, as files with their sound.
(() => {
  // The files of a video that Reddit's player lists in its packaged-media-json, largest first: one at each size,
  // sound included, in two codecs (VP9 and H.264), Reddit's own order kept between those of a size. The same
  // player comes up on every move of the mouse over it, so the last list is kept.
  let last = { json: null, urls: [] };
  function filesOf(json) {
    if (json === last.json) return last.urls;
    let sources = [];
    try {
      sources = JSON.parse(json).playbackMp4s.permutations.map((permutation) => permutation.source);
    } catch (err) {
      // Not the list Reddit gives: no files.
    }
    const area = (source) => Number(source.dimensions.width) * Number(source.dimensions.height) || 0;
    const urls = sources
      .filter((source) => !!source && !!source.dimensions && /^https?:\/\//.test(source.url))
      .sort((a, b) => area(b) - area(a))
      .map((source) => source.url);
    last = { json, urls };
    return urls;
  }

  addSite({
    name: 'Reddit',
    larger: [
      // Reddit shows copies at most 1080 px wide (preview.redd.it); the original upload is on i.redd.it, under the
      // copy's id. Newer copies put words from the post's title before the id: some-title-v0-<id>.png.
      [/^https?:\/\/preview\.redd\.it\/(?:[^?#]*-v\d+-)?([a-z0-9]+)\.(jpe?g|png|gif|webp)(?:[?#].*)?$/i, 'https://i.redd.it/$1.$2'],
    ],

    // A gallery: <gallery-carousel> holds every slide as an <li>, the ones not in view yet included.
    gallery(el, page) {
      // A slide's picture, rather than the blurred copy of it that fills the space around it.
      const slideImage = (li) => {
        const images = li.getElementsByTagName('img');
        let fallback = null;
        for (let i = 0; i < images.length; i++) {
          if (images[i].classList.contains('media-lightbox-img')) return images[i];
          if (!fallback && !images[i].closest('.post-background-image-filter')) fallback = images[i];
        }
        return fallback;
      };
      const carousel = page.closestAcross(el, 'gallery-carousel');
      if (!carousel) return null;
      const slides = [];
      const items = carousel.getElementsByTagName('li');
      for (let i = 0; i < items.length; i++) {
        const img = slideImage(items[i]);
        if (img) slides.push({ li: items[i], img });
      }
      const index = slides.findIndex((slide) => slide.li.contains(el));
      if (slides.length < 2 || index < 0) return null;
      return { images: slides.map((slide) => slide.img), index };
    },

    // A video: <shreddit-player> (or <shreddit-player-2>) streams it, and lists files of it for sharing.
    video(el, page) {
      const player = page.closestAcross(el, 'shreddit-player, shreddit-player-2');
      const urls = player ? filesOf(player.getAttribute('packaged-media-json')) : [];
      return urls.length ? { urls, poster: player.getAttribute('poster') || '' } : null;
    },
  });
})();
