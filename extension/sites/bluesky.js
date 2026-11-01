// Bluesky: images and profile pictures as uploaded, and the images of a post.
addSite({
  name: 'Bluesky',
  larger: [
    // Posts show their images as feed_thumbnail, at most 1000 px; feed_fullsize is the image as posted.
    [/^(https?:\/\/cdn\.bsky\.app\/img\/)feed_thumbnail\//, '$1feed_fullsize/'],
    // Profile pictures: avatar_thumbnail is 128 px, avatar 1000 px.
    [/^(https?:\/\/cdn\.bsky\.app\/img\/)avatar_thumbnail\//, '$1avatar/'],
  ],

  // The images of a post, in order. A post is a feedItem-by-… or postThreadItem-by-… (data-testid, which
  // Bluesky's own tests use), and each of its images is a button that opens Bluesky's viewer. A quoted post
  // inside it is a link (role="link") of its own, whose images are its own gallery; a link card's image is
  // inside a link, not a button, so it's left out.
  gallery(el) {
    const POST = '[data-testid^="feedItem-by-"], [data-testid^="postThreadItem-by-"]';
    if (el.localName !== 'img' || !el.closest(POST)) return null;
    const postOf = (img) => img.closest(POST + ', [role="link"]');
    const inButton = (img) => {
      const holder = img.closest('a, button');
      return !!holder && holder.localName === 'button';
    };
    const post = postOf(el);
    if (!inButton(el)) return null;
    const images = Array.prototype.filter.call(post.getElementsByTagName('img'), (img) => inButton(img) && postOf(img) === post);
    const index = images.indexOf(el);
    if (images.length < 2 || index < 0) return null;
    return { images, index };
  },
});
