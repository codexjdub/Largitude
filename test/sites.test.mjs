// Unit tests for the site rules in extension/sites/, loaded the way the extension loads them: after helpers.js,
// as the manifest lists its content scripts. content.js, which needs a page, is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const extension = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', extension), 'utf8'));
const context = vm.createContext({ URL });
for (const file of manifest.content_scripts[0].js.filter((file) => file !== 'content.js')) {
  vm.runInContext(readFileSync(new URL(file, extension), 'utf8'), context, { filename: file });
}
const { SITES, fullSizeUrls, isStandIn, isLeftAlone } = context;
// Objects made inside the context have its own Object prototype, which deepEqual tells apart.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('each site has a name, [find, replace] rules and, optionally, a gallery', () => {
  assert.ok(SITES.length > 0);
  for (const site of SITES) {
    assert.equal(typeof site.name, 'string');
    for (const rule of site.larger || []) {
      assert.equal(rule.length, 2, site.name);
      const [find, replace] = rule;
      assert.equal(Object.prototype.toString.call(find), '[object RegExp]', site.name);
      // A global or sticky expression remembers where it last matched, so find.test would skip addresses.
      assert.ok(!find.global && !find.sticky, `${site.name}: ${find}`);
      assert.ok(typeof replace === 'string' || typeof replace === 'function', `${site.name}: ${find}`);
    }
    for (const hook of ['gallery', 'standIn', 'leaveAlone', 'video', 'original']) {
      assert.ok(site[hook] === undefined || typeof site[hook] === 'function', `${site.name}: ${hook}`);
    }
  }
});

test('Reddit: its copies lead to the original upload', () => {
  const original = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(original('https://preview.redd.it/abc123def.png?width=1080&format=png&auto=webp&s=0f1e'), [
    'https://i.redd.it/abc123def.png',
  ]);
  // Newer copies put words from the post's title before the id.
  assert.deepEqual(original('https://preview.redd.it/hyprland-my-minimalist-setup-v0-x9y8z7w6.jpg?width=640&crop=smart&s=1'), [
    'https://i.redd.it/x9y8z7w6.jpg',
  ]);
  assert.deepEqual(original('https://preview.redd.it/k3j4h5.gif?format=png8&s=2'), ['https://i.redd.it/k3j4h5.gif']);
  // Link previews of other sites have no original on Reddit.
  assert.deepEqual(original('https://external-preview.redd.it/AbC.jpg?auto=webp&s=3'), []);
  assert.deepEqual(original('https://i.redd.it/abc123def.png'), []);
});

test("Reddit: a video's files, largest first, from its player", () => {
  const reddit = SITES.find((site) => site.name === 'Reddit');
  // A <shreddit-player> as Reddit writes it, cut down to two sizes in each codec.
  const file = (codec, height) =>
    `https://packaged-media.redd.it/c9hjorqb31zh1/pb/m2-${codec}res_${height}p.mp4?m=DASHPlaylist.mpd&v=1&e=1793613600&s=0bcd`;
  const source = (codec, width, height) => ({
    source: { bitrateBps: 1, dimensions: { height, width }, url: file(codec, height), videoCodec: codec ? 'VP9' : 'H264' },
  });
  const permutations = [source('vp9-', 392, 220), source('vp9-', 1280, 720), source('', 392, 220), source('', 1280, 720)];
  const poster = 'https://external-preview.redd.it/gamer-showcases-his-flying-skills-in-gta-sa-v0-eDdvanhm.png?width=640&s=2127';
  const player = (attributes) => ({ getAttribute: (name) => (name in attributes ? attributes[name] : null) });
  const page = (found) => ({ closestAcross: (el, selector) => (/\bshreddit-player\b/.test(selector) ? found : null) });
  const videoIn = (found) => plain(reddit.video({ localName: 'video' }, page(found)));

  const json = JSON.stringify({ playbackMp4s: { duration: 97, permutations } });
  assert.deepEqual(videoIn(player({ 'packaged-media-json': json, poster })), {
    urls: [file('vp9-', 720), file('', 720), file('vp9-', 220), file('', 220)],
    poster,
  });
  // Outside a player, or a player without the list or with something else in it: nothing.
  assert.equal(reddit.video({ localName: 'video' }, page(null)), null);
  assert.equal(videoIn(player({ poster })), null);
  assert.equal(videoIn(player({ 'packaged-media-json': '{"playbackMp4s":' })), null);
  const odd = [{ source: { dimensions: { width: 1, height: 1 }, url: 'javascript:alert(1)' } }, { source: null }, {}];
  assert.equal(videoIn(player({ 'packaged-media-json': JSON.stringify({ playbackMp4s: { permutations: odd } }) })), null);
});

test('X: photos, profile pictures and banners at their original size', () => {
  const original = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(original('https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=small'), [
    'https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=orig',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/media/GaBcDeF?format=webp&name=900x900'), [
    'https://pbs.twimg.com/media/GaBcDeF?format=webp&name=orig',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/media/GaBcDeF.jpg:large'), [
    'https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=orig',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/AbC.jpg?name=small'), [
    'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/AbC?format=jpg&name=orig',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=orig'), []);
  assert.deepEqual(original('https://pbs.twimg.com/profile_images/1234/Ab_cD_normal.jpg'), [
    'https://pbs.twimg.com/profile_images/1234/Ab_cD.jpg',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/profile_images/1234/photo_400x400.png'), [
    'https://pbs.twimg.com/profile_images/1234/photo.png',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/profile_banners/42/1700000000/600x200'), [
    'https://pbs.twimg.com/profile_banners/42/1700000000/1500x500',
  ]);
  assert.deepEqual(original('https://pbs.twimg.com/profile_banners/42/1700000000/1500x500'), []);
});

test("X: a GIF's still leads to its video, then to the still at its largest", () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://pbs.twimg.com/tweet_video_thumb/GaB-cD_eF.jpg'), [
    'https://video.twimg.com/tweet_video/GaB-cD_eF.mp4',
    'https://pbs.twimg.com/tweet_video_thumb/GaB-cD_eF?format=jpg&name=orig',
  ]);
  assert.deepEqual(larger('https://pbs.twimg.com/tweet_video_thumb/GaBcDeF?format=jpg&name=small'), [
    'https://video.twimg.com/tweet_video/GaBcDeF.mp4',
    'https://pbs.twimg.com/tweet_video_thumb/GaBcDeF?format=jpg&name=orig',
  ]);
  // A real video's still has no video at an address of its own.
  assert.deepEqual(larger('https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/AbC.jpg'), [
    'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/AbC?format=jpg&name=orig',
  ]);
});

test('Imgur: thumbnails and links to an image lead to the original', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://i.imgur.com/gnffQGHb.jpg'), ['https://i.imgur.com/gnffQGH.jpg']);
  assert.deepEqual(larger('https://i.imgur.com/r9OlPoCl.png'), ['https://i.imgur.com/r9OlPoC.png']);
  assert.deepEqual(larger('https://i.imgur.com/AbCdEh.jpg'), ['https://i.imgur.com/AbCdE.jpg']);
  // An original's own address: 5 or 7 characters, no size letter to take off.
  assert.deepEqual(larger('https://i.imgur.com/r9OlPoC.jpg'), []);
  assert.deepEqual(larger('https://i.imgur.com/AbCdE.jpg'), []);
  assert.deepEqual(larger('https://imgur.com/r9OlPoC'), ['https://i.imgur.com/r9OlPoC.jpg']);
  assert.deepEqual(larger('https://m.imgur.com/AbC12?r'), ['https://i.imgur.com/AbC12.jpg']);
  // Imgur's own pages and albums.
  assert.deepEqual(larger('https://imgur.com/privacy'), []);
  assert.deepEqual(larger('https://imgur.com/gallery/uHLvLbB'), []);
  assert.deepEqual(larger('https://imgur.com/a/uHLvLbB'), []);
});

test('YouTube: a video\'s largest still, from its thumbnails and links to it', () => {
  const stills = (id) => ['maxresdefault', 'sddefault', 'hqdefault'].map((size) => `https://i.ytimg.com/vi/${id}/${size}.jpg`);
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'), stills('dQw4w9WgXcQ').slice(0, 2));
  assert.deepEqual(larger('https://i9.ytimg.com/vi_webp/a-b_c1234XY/mqdefault.webp?v=1'), stills('a-b_c1234XY'));
  assert.deepEqual(larger('https://img.youtube.com/vi/dQw4w9WgXcQ/0.jpg'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://youtu.be/dQw4w9WgXcQ?si=abc'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://m.youtube.com/shorts/dQw4w9WgXcQ'), stills('dQw4w9WgXcQ'));
  assert.deepEqual(larger('https://www.youtube.com/@someone/videos'), []);
  assert.deepEqual(larger('https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg'), stills('dQw4w9WgXcQ').slice(1));
});

test('YouTube: a missing still is a stand-in, and YouTube keeps its own thumbnails', () => {
  assert.equal(isStandIn('https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg', { width: 120, height: 90 }), true);
  assert.equal(isStandIn('https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg', { width: 480, height: 360 }), false);
  assert.equal(isStandIn('https://example.com/small.jpg', { width: 120, height: 90 }), false);
  const thumbnail = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hq720.jpg?sqp=abc&rs=def';
  assert.equal(isLeftAlone(thumbnail, 'https://www.youtube.com/'), true);
  assert.equal(isLeftAlone('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/results?q=a'), true);
  assert.equal(isLeftAlone(thumbnail, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), true);
  // Profile pictures on YouTube, and YouTube's thumbnails elsewhere, are Largitude's.
  assert.equal(isLeftAlone('https://yt3.ggpht.com/abc=s88-c-k', 'https://www.youtube.com/'), false);
  assert.equal(isLeftAlone(thumbnail, 'https://news.example.com/article'), false);
  assert.equal(isLeftAlone(thumbnail, 'https://notyoutube.com/'), false);
});

test('Imgur: a GIFV is its MP4', () => {
  assert.deepEqual(plain(fullSizeUrls('https://i.imgur.com/AbC123x.gifv')), ['https://i.imgur.com/AbC123x.mp4']);
  assert.deepEqual(plain(fullSizeUrls('https://i.imgur.com/AbC123x.gifv?1')), ['https://i.imgur.com/AbC123x.mp4']);
  assert.deepEqual(plain(fullSizeUrls('https://i.imgur.com/AbC123x.mp4')), []);
  assert.deepEqual(plain(fullSizeUrls('https://example.com/AbC123x.gifv')), []);
});

test('Image services: WordPress copies lead to the upload', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://example.com/wp-content/uploads/2026/10/photo-300x200.jpg'), [
    'https://example.com/wp-content/uploads/2026/10/photo.jpg',
  ]);
  assert.deepEqual(larger('https://techcrunch.com/wp-content/uploads/2025/06/GettyImages-2217198328.jpeg?w=668'), [
    'https://techcrunch.com/wp-content/uploads/2025/06/GettyImages-2217198328.jpeg',
  ]);
  assert.deepEqual(larger('https://example.com/blog/wp-content/uploads/a-1024x768.PNG?resize=604%2C453'), [
    'https://example.com/blog/wp-content/uploads/a.PNG',
  ]);
  assert.deepEqual(larger('https://someone.files.wordpress.com/2024/05/cat.jpg?w=300&h=200'), [
    'https://someone.files.wordpress.com/2024/05/cat.jpg',
  ]);
  assert.deepEqual(larger('https://i0.wp.com/ma.tt/files/2026/10/MCM_0869-1024x683.jpg?resize=604%2C403&quality=89&ssl=1'), [
    'https://ma.tt/files/2026/10/MCM_0869.jpg',
  ]);
  assert.deepEqual(larger('https://i2.wp.com/wordpress.org/news/files/2024/01/featured.jpg?w=1920&ssl=1'), [
    'https://wordpress.org/news/files/2024/01/featured.jpg',
  ]);
  assert.deepEqual(larger('https://example.com/wp-content/uploads/2026/10/photo.jpg'), []);
  // Not WordPress, though the name looks like a copy's.
  assert.deepEqual(larger('https://example.com/images/wallpaper-1920x1080.jpg'), []);
});

test('Image services: Next.js, Cloudinary and imgix copies lead to the image they were made from', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://nextjs.org/_next/image?url=%2F_next%2Fstatic%2Fmedia%2Fsonos.1zcq.png&w=750&q=75'), [
    'https://nextjs.org/_next/static/media/sonos.1zcq.png',
  ]);
  assert.deepEqual(larger('https://example.com/shop/_next/image?w=640&url=https%3A%2F%2Fcdn.example.net%2Fa.jpg&q=75'), [
    'https://cdn.example.net/a.jpg',
  ]);
  assert.deepEqual(larger('https://example.com/_next/image?url=javascript%3Aalert(1)&w=640'), []);
  assert.deepEqual(larger('https://res.cloudinary.com/demo/image/upload/w_300,c_scale/sample.jpg'), [
    'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  ]);
  assert.deepEqual(larger('https://res.cloudinary.com/demo/image/upload/c_thumb,w_200,g_face/r_max/v1/people/sample.jpg'), [
    'https://res.cloudinary.com/demo/image/upload/v1/people/sample.jpg',
  ]);
  assert.deepEqual(larger('https://res.cloudinary.com/demo/image/fetch/w_300/https://example.com/a.jpg'), [
    'https://res.cloudinary.com/demo/image/fetch/https://example.com/a.jpg',
  ]);
  // A folder whose name only looks like a step.
  assert.deepEqual(larger('https://res.cloudinary.com/demo/image/upload/my_photos/sample.jpg'), []);
  assert.deepEqual(larger('https://res.cloudinary.com/demo/image/upload/v1/sample.jpg'), []);
  assert.deepEqual(larger('https://assets.imgix.net/hp/snowshoe.jpg?w=300&auto=format'), ['https://assets.imgix.net/hp/snowshoe.jpg']);
  assert.deepEqual(larger('https://assets.imgix.net/hp/snowshoe.jpg'), []);
});

test('Image services: Google images at their original size', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://play-lh.googleusercontent.com/jQAmlGUkuJGc=w240-h480-rw'), [
    'https://play-lh.googleusercontent.com/jQAmlGUkuJGc=s0',
  ]);
  assert.deepEqual(larger('https://yt3.ggpht.com/ytc/AIdro_k=s88-c-k-c0x00ffffff-no-rj'), ['https://yt3.ggpht.com/ytc/AIdro_k=s0']);
  assert.deepEqual(larger('https://lh3.googleusercontent.com/a/ACg8ocK=s96-c'), ['https://lh3.googleusercontent.com/a/ACg8ocK=s0']);
  assert.deepEqual(larger('https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh/s320/photo.jpg'), [
    'https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh/s0/photo.jpg',
  ]);
  assert.deepEqual(larger('https://1.bp.blogspot.com/-abc/XyZ/AAAA/def/w640-h400/photo.png'), [
    'https://1.bp.blogspot.com/-abc/XyZ/AAAA/def/s0/photo.png',
  ]);
  assert.deepEqual(larger('https://lh3.googleusercontent.com/a/ACg8ocK=s0'), []);
  assert.deepEqual(larger('https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEh/s0/photo.jpg'), []);
});

test('Amazon and IMDb: product photos and posters as uploaded', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://m.media-amazon.com/images/I/71DQp57-ltL._AC_UY654_FMwebp_QL65_.jpg'), [
    'https://m.media-amazon.com/images/I/71DQp57-ltL.jpg',
  ]);
  assert.deepEqual(larger('https://m.media-amazon.com/images/I/411PvYeI6VL._AC_SR250,250_QL65_.jpg'), [
    'https://m.media-amazon.com/images/I/411PvYeI6VL.jpg',
  ]);
  assert.deepEqual(larger('https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00@._V1_QL75_UX90_CR0,1,90,133_.jpg'), [
    'https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00@.jpg',
  ]);
  assert.deepEqual(larger('https://images-na.ssl-images-amazon.com/images/I/51abc._SX300_.jpg'), [
    'https://images-na.ssl-images-amazon.com/images/I/51abc.jpg',
  ]);
  assert.deepEqual(larger('https://m.media-amazon.com/images/I/71DQp57-ltL.jpg'), []);
  // The site's own pictures (G/) only carry a version number.
  assert.deepEqual(larger('https://m.media-amazon.com/images/G/01/gno/sprites/nav-sprite._CB779528203_.png'), []);
});

test('Wikipedia: the original file behind a thumbnail', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(
    larger(
      'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d2/Red_fox_%28cropped%29.jpg/250px-Red_fox_%28cropped%29.jpg?utm_source=en.wikipedia.org&utm_campaign=parser',
    ),
    ['https://upload.wikimedia.org/wikipedia/commons/d/d2/Red_fox_%28cropped%29.jpg'],
  );
  assert.deepEqual(larger('https://upload.wikimedia.org/wikipedia/en/thumb/9/94/Symbol_support_vote.svg/20px-Symbol_support_vote.svg.png'), [
    'https://upload.wikimedia.org/wikipedia/en/9/94/Symbol_support_vote.svg',
  ]);
  // Originals that aren't images.
  assert.deepEqual(larger('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Report.pdf/page1-220px-Report.pdf.jpg'), []);
  assert.deepEqual(larger('https://upload.wikimedia.org/wikipedia/commons/thumb/e/e7/Kits.webm/220px--Kits.webm.jpg'), []);
  assert.deepEqual(larger('https://upload.wikimedia.org/wikipedia/commons/d/d2/Red_fox.jpg'), []);
});

test('Bluesky: images and profile pictures as uploaded', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:wzt3ejirk3rvz6t5f5plxt3x/bafkreidoghorjyam'), [
    'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:wzt3ejirk3rvz6t5f5plxt3x/bafkreidoghorjyam',
  ]);
  assert.deepEqual(larger('https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/bafkreiabc@jpeg'), [
    'https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkreiabc@jpeg',
  ]);
  assert.deepEqual(larger('https://cdn.bsky.app/img/avatar_thumbnail/plain/did:plc:abc/bafkreiabc'), [
    'https://cdn.bsky.app/img/avatar/plain/did:plc:abc/bafkreiabc',
  ]);
  assert.deepEqual(larger('https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafkreiabc'), []);
});

test('Pinterest: the original, then the largest copy', () => {
  assert.deepEqual(plain(fullSizeUrls('https://i.pinimg.com/236x/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg')), [
    'https://i.pinimg.com/originals/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg',
    'https://i.pinimg.com/1200x/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg',
  ]);
  assert.deepEqual(plain(fullSizeUrls('https://i.pinimg.com/1200x/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg')), [
    'https://i.pinimg.com/originals/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg',
  ]);
  assert.deepEqual(plain(fullSizeUrls('https://i.pinimg.com/originals/ea/66/54/ea6654a812e58540250060ffc84c43e7.jpg')), []);
});

test('Flickr: photos at 1024 px', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://live.staticflickr.com/65535/55619969470_98f4184b1c_w.jpg'), [
    'https://live.staticflickr.com/65535/55619969470_98f4184b1c_b.jpg',
  ]);
  assert.deepEqual(larger('https://live.staticflickr.com/65535/55619969470_98f4184b1c.jpg'), [
    'https://live.staticflickr.com/65535/55619969470_98f4184b1c_b.jpg',
  ]);
  assert.deepEqual(larger('https://farm5.staticflickr.com/4567/12345678_abcdef1234_m.jpg'), [
    'https://farm5.staticflickr.com/4567/12345678_abcdef1234_b.jpg',
  ]);
  // Already 1024 px, or larger.
  assert.deepEqual(larger('https://live.staticflickr.com/65535/55619969470_98f4184b1c_b.jpg'), []);
  assert.deepEqual(larger('https://live.staticflickr.com/65535/55619969470_0fedcba987_k.jpg'), []);
});

test('eBay: listing photos at their largest', () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://i.ebayimg.com/images/g/R6YAAeSwyhVq5pks/s-l500.webp'), [
    'https://i.ebayimg.com/images/g/R6YAAeSwyhVq5pks/s-l1600.webp',
  ]);
  assert.deepEqual(larger('https://i.ebayimg.com/thumbs/images/g/R6YAAeSwyhVq5pks/s-l225.jpg'), [
    'https://i.ebayimg.com/images/g/R6YAAeSwyhVq5pks/s-l1600.jpg',
  ]);
  assert.deepEqual(larger('https://i.ebayimg.com/images/g/R6YAAeSwyhVq5pks/s-l1600.webp'), []);
});

test("Giphy: a GIF's copy or still leads to its video", () => {
  const larger = (url) => plain(fullSizeUrls(url));
  assert.deepEqual(larger('https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/DCZb48uIFPQEWXVC0w/200w.webp'), [
    'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjEx/DCZb48uIFPQEWXVC0w/giphy.mp4',
  ]);
  assert.deepEqual(larger('https://media.giphy.com/media/MsJO9AUbrLWy4/200w_s.gif'), ['https://media.giphy.com/media/MsJO9AUbrLWy4/giphy.mp4']);
  assert.deepEqual(larger('https://media.giphy.com/media/MsJO9AUbrLWy4/giphy_s.gif'), ['https://media.giphy.com/media/MsJO9AUbrLWy4/giphy.mp4']);
  assert.deepEqual(larger('https://media.giphy.com/media/MsJO9AUbrLWy4/giphy.gif'), []);
  assert.deepEqual(larger('https://media.giphy.com/media/MsJO9AUbrLWy4/giphy.webp'), []);
});

test('other sites are left alone', () => {
  assert.deepEqual(plain(fullSizeUrls('https://example.com/photo.jpg?name=small')), []);
  assert.deepEqual(plain(fullSizeUrls('not a url')), []);
});

test("Google Images: a result's original, from the page's scripts", () => {
  const google = SITES.find((site) => site.name === 'Google Images');
  // As Google's page lists a result, in a script of several hundred kilobytes.
  const listing =
    'var m={"nV7paoT":[1,[0,"Y9jcXztxNgSz8M",["https://encrypted-tbn0.gstatic.com/images?q\\u003dtbn:ANd9GcQ\\u0026s\\u003d10",447,447],' +
    '["https://mountainhouse.com/cdn/shop/articles/lake_1024x.jpg?v\\u003d1766161643",1024,1024],null,0,"rgb(112,166,208)"]]};';
  const page = (href, texts) => ({ location: { href }, scripts: texts.map((textContent) => ({ textContent })) });
  // An image in the result with `id`, or in no result.
  const image = (doc, id) => ({ ownerDocument: doc, closest: () => (id ? { getAttribute: () => id } : null) });
  const search = page('https://www.google.com/search?q=mountain+lake&udm=2', ['google.kEXPI="0,1";', listing]);
  assert.equal(google.original(image(search, 'Y9jcXztxNgSz8M')), 'https://mountainhouse.com/cdn/shop/articles/lake_1024x.jpg?v=1766161643');
  // A result loaded while scrolling, which the scripts don't list, and an image outside the results.
  assert.equal(google.original(image(search, 'c_auKTKZbHSCMM')), '');
  assert.equal(google.original(image(search, null)), '');
  // Google's other countries; other pages, which may list the same thing, are left alone.
  assert.equal(google.original(image(page('https://www.google.co.uk/search?q=lake', [listing]), 'Y9jcXztxNgSz8M')), 'https://mountainhouse.com/cdn/shop/articles/lake_1024x.jpg?v=1766161643');
  assert.equal(google.original(image(page('https://example.com/search?q=lake', [listing]), 'Y9jcXztxNgSz8M')), '');
  assert.equal(google.original(image(page('https://www.google.com/maps', [listing]), 'Y9jcXztxNgSz8M')), '');
  // Scripts added later are read too.
  search.scripts.push({ textContent: listing.replace('Y9jcXztxNgSz8M', 'c_auKTKZbHSCMM') });
  assert.equal(google.original(image(search, 'c_auKTKZbHSCMM')), 'https://mountainhouse.com/cdn/shop/articles/lake_1024x.jpg?v=1766161643');
});
