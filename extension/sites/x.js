// X: its photos, profile pictures and banners at their largest, and the photos of a post.
addSite({
  name: 'X',
  larger: [
    // Photos and video stills. Older addresses carry the format in the path: <id>.jpg, or <id>.jpg:large.
    [
      /^(https?:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[^?#]+?)\.(jpe?g|png|webp)(?::\w+)?(?:[?#].*)?$/i,
      (match, path, format) => path + '?format=' + format.toLowerCase() + '&name=orig',
    ],
    // Newer ones give it in format=, and name= picks the size: small, medium, large, orig, ….
    [
      /^https?:\/\/pbs\.twimg\.com\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/[^?#.]+(?:[?#].*)?$/,
      (address) => {
        const url = new URL(address);
        url.searchParams.set('name', 'orig');
        return url.href;
      },
    ],
    // Profile pictures are cut down from the original, named with _normal, _bigger, _400x400 and the like.
    [/^(https?:\/\/pbs\.twimg\.com\/profile_images\/[^?#]+?)_(?:normal|bigger|mini|reasonably_small|\d+x\d+)(\.\w+)(?:[?#].*)?$/, '$1$2'],
    // Profile banners: the last part of the path is the size; 1500x500 is the largest.
    [/^(https?:\/\/pbs\.twimg\.com\/profile_banners\/\d+\/\d+)\/\d+x\d+(?:[?#].*)?$/, '$1/1500x500'],
  ],

  // The photos of a post, in order: each is a link to …/status/<post>/photo/<number> in the post's <article>.
  // A quoted post's photos have another post's number, so they're left out.
  gallery(el, page) {
    const link = page.closestLink(el);
    const match = link && /\/status\/(\d+)\/photo\/(\d+)$/.exec(link.pathname);
    const post = match && page.closestAcross(link, 'article');
    if (!post) return null;
    const photos = [];
    const links = post.querySelectorAll('a[href*="/status/' + match[1] + '/photo/"]');
    for (let i = 0; i < links.length; i++) {
      const number = /\/photo\/(\d+)$/.exec(links[i].pathname);
      const img = links[i].querySelector('img');
      if (!number || !img || photos.some((photo) => photo.number === Number(number[1]))) continue;
      photos.push({ number: Number(number[1]), img });
    }
    photos.sort((a, b) => a.number - b.number);
    const index = photos.findIndex((photo) => photo.number === Number(match[2]));
    if (photos.length < 2 || index < 0) return null;
    return { images: photos.map((photo) => photo.img), index };
  },
});
