// Unit tests for extension/helpers.js, loaded the way the extension loads it: as a plain script, whose
// function declarations become globals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../extension/helpers.js', import.meta.url), 'utf8'), context, { filename: 'helpers.js' });
const { hostOf, isExcluded, parseSrcset, largestCandidate, isImageFileUrl, fullSizeUrls, fileNameFor, placePopup, isWorthShowing } =
  context;
// Objects made inside the context have its own Object prototype, which deepEqual tells apart.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('hostOf keeps only the host name of an entry', () => {
  assert.equal(hostOf('  Example.com '), 'example.com');
  assert.equal(hostOf('https://www.example.com:8080/page?x=1#top'), 'www.example.com');
  assert.equal(hostOf('*.example.com'), 'example.com');
});

test('isExcluded matches a site and its subdomains, not look-alikes', () => {
  const list = 'example.com\nhttps://news.test/page, *.cdn.org';
  assert.equal(isExcluded(list, 'https://example.com/a'), true);
  assert.equal(isExcluded(list, 'https://img.example.com/a'), true);
  assert.equal(isExcluded(list, 'https://notexample.com/a'), false);
  assert.equal(isExcluded(list, 'http://news.test/other'), true);
  assert.equal(isExcluded(list, 'https://a.cdn.org/x'), true);
  assert.equal(isExcluded('', 'https://example.com/'), false);
  assert.equal(isExcluded(list, 'about:blank'), false);
  assert.equal(isExcluded(list, 'not a url'), false);
});

test('parseSrcset reads width and density descriptors', () => {
  assert.deepEqual(plain(parseSrcset('a.jpg 200w, b.jpg 800w')), [
    { url: 'a.jpg', w: 200 },
    { url: 'b.jpg', w: 800 },
  ]);
  assert.deepEqual(plain(parseSrcset('a.jpg, b.jpg 2x,c.jpg 1.5x')), [{ url: 'a.jpg' }, { url: 'b.jpg', x: 2 }, { url: 'c.jpg', x: 1.5 }]);
});

test('parseSrcset keeps commas that are part of an address', () => {
  assert.deepEqual(plain(parseSrcset('https://res.cloudinary.com/x/image/upload/w_400,c_fill/p.jpg 400w, /w_800,c_fill/p.jpg 800w')), [
    { url: 'https://res.cloudinary.com/x/image/upload/w_400,c_fill/p.jpg', w: 400 },
    { url: '/w_800,c_fill/p.jpg', w: 800 },
  ]);
  assert.deepEqual(plain(parseSrcset('data:image/png;base64,iVBORw0KGgo= 1x, big.png 2x')), [
    { url: 'data:image/png;base64,iVBORw0KGgo=', x: 1 },
    { url: 'big.png', x: 2 },
  ]);
});

test('parseSrcset copes with odd spacing, trailing commas and empty input', () => {
  assert.deepEqual(plain(parseSrcset('  a.jpg   100w ,  b.jpg,,  c.jpg 300w  ')), [
    { url: 'a.jpg', w: 100 },
    { url: 'b.jpg' },
    { url: 'c.jpg', w: 300 },
  ]);
  assert.deepEqual(plain(parseSrcset('')), []);
  assert.deepEqual(plain(parseSrcset(null)), []);
  // Unknown descriptors are ignored; a comma inside parentheses doesn't end the candidate.
  assert.deepEqual(plain(parseSrcset('a.jpg 100w 50h, b.jpg future(1, 2) 200w')), [
    { url: 'a.jpg', w: 100 },
    { url: 'b.jpg', w: 200 },
  ]);
});

test('largestCandidate prefers width, then density', () => {
  assert.equal(largestCandidate(plain(parseSrcset('a 200w, b 1600w, c 800w'))).url, 'b');
  assert.equal(largestCandidate(plain(parseSrcset('a, b 3x, c 2x'))).url, 'b');
  // With both kinds, only candidates with a width compete.
  assert.equal(largestCandidate(plain(parseSrcset('a 3x, b 400w'))).url, 'b');
  assert.equal(largestCandidate([]), null);
});

test('isImageFileUrl goes by the extension of the path', () => {
  assert.equal(isImageFileUrl('https://example.com/photos/cat.JPG'), true);
  assert.equal(isImageFileUrl('https://example.com/cat.webp?w=200#x'), true);
  assert.equal(isImageFileUrl('http://example.com/a.svg'), true);
  assert.equal(isImageFileUrl('https://example.com/cat.jpg.html'), false);
  assert.equal(isImageFileUrl('https://example.com/gallery/'), false);
  assert.equal(isImageFileUrl('ftp://example.com/cat.jpg'), false);
  assert.equal(isImageFileUrl('nonsense'), false);
});

test("fullSizeUrls turns Reddit's copies into the original upload", () => {
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

test("fullSizeUrls asks X for its photos' original size", () => {
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

test('fullSizeUrls leaves other sites alone', () => {
  assert.deepEqual(plain(fullSizeUrls('https://example.com/photo.jpg?name=small')), []);
  assert.deepEqual(plain(fullSizeUrls('not a url')), []);
});

test('fileNameFor names a saved image after its address', () => {
  assert.equal(fileNameFor('https://i.redd.it/abc123def.png'), 'abc123def.png');
  assert.equal(fileNameFor('https://preview.redd.it/my-setup-v0-x9y8.jpg?width=1080&format=pjpg&s=1'), 'my-setup-v0-x9y8.jpg');
  // X gives the type in ?format=, or after the name with its size: photo.jpg:large.
  assert.equal(fileNameFor('https://pbs.twimg.com/media/GaBcDeF?format=jpg&name=orig'), 'GaBcDeF.jpg');
  assert.equal(fileNameFor('https://pbs.twimg.com/media/GaBcDeF?format=webp&name=orig'), 'GaBcDeF.webp');
  assert.equal(fileNameFor('https://pbs.twimg.com/media/GaBcDeF.jpg:large'), 'GaBcDeF.jpg');
  assert.equal(fileNameFor('https://example.com/photos/sunset%20at%20sea.JPG?w=200'), 'sunset at sea.JPG');
});

test('fileNameFor leaves the name to Firefox when the address has none, and cleans odd characters', () => {
  assert.equal(fileNameFor('https://example.com/'), '');
  assert.equal(fileNameFor('https://example.com/image?id=4'), 'image');
  assert.equal(fileNameFor('not a url'), '');
  assert.equal(fileNameFor('https://example.com/a%3Cb%3E%22c%22.png'), 'a_b_c_.png');
  assert.equal(fileNameFor('https://example.com/..hidden.png'), 'hidden.png');
  const long = fileNameFor('https://example.com/' + 'x'.repeat(300) + '.png');
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.png'));
});

const view = { width: 1200, height: 800 };
const within = (box) => box.left >= 0 && box.top >= 0 && box.left + box.width <= view.width && box.top + box.height <= view.height;
const covers = (box, p) => p.x >= box.left && p.x < box.left + box.width && p.y >= box.top && p.y < box.top + box.height;

test('placePopup shows a small image at its own size, beside the pointer', () => {
  const pointer = { x: 300, y: 400 };
  const box = placePopup({ width: 400, height: 300 }, pointer, view);
  assert.equal(box.side, 'right');
  assert.equal(box.width, 400);
  assert.equal(box.height, 300);
  assert.equal(box.left, 316);
  assert.equal(box.top, 250);
  assert.ok(within(box) && !covers(box, pointer));
});

test('placePopup picks the side with the most room', () => {
  const nearRight = placePopup({ width: 1600, height: 1200 }, { x: 1100, y: 400 }, view);
  assert.equal(nearRight.side, 'left');
  assert.ok(within(nearRight) && !covers(nearRight, { x: 1100, y: 400 }));
  // A wide image fits better above or below.
  const wide = placePopup({ width: 2400, height: 600 }, { x: 600, y: 100 }, view);
  assert.equal(wide.side, 'below');
  assert.ok(within(wide));
  assert.equal(wide.top, 116);
});

test('placePopup keeps the shape and stays inside the window near its edges', () => {
  const pointer = { x: 50, y: 790 };
  const box = placePopup({ width: 1000, height: 1000 }, pointer, view);
  assert.ok(within(box) && !covers(box, pointer));
  assert.ok(Math.abs(box.width - box.height) <= 1);
});

test('placePopup covers the window when no side has room enough', () => {
  // The pointer in the middle leaves each side under two thirds of what the whole window allows.
  const pointer = { x: 600, y: 400 };
  const box = placePopup({ width: 1600, height: 1200 }, pointer, view);
  assert.equal(box.side, 'cover');
  assert.ok(within(box));
  assert.equal(box.height, 784);
});

test("placePopup covers the window when only that shows the image clearly bigger than the page", () => {
  // A 730 px wide image on the page and a 1080 px original. With the pointer in the middle, the best side (below)
  // has room for 756 px, under 20% more than the page shows, while the whole window fits all 1080.
  const natural = { width: 1080, height: 608 };
  const shown = { width: 730, height: 411 };
  const wide = { width: 1440, height: 820 };
  const box = placePopup(natural, { x: 720, y: 370 }, wide, shown);
  assert.equal(box.side, 'cover');
  assert.equal(box.width, 1080);
  // Without the page's size to go by, the side with the most room is kept.
  const unsized = placePopup(natural, { x: 720, y: 370 }, wide);
  assert.equal(unsized.side, 'below');
  assert.equal(unsized.width, 756);
  // Wherever the pointer is on the image, the popup shows it clearly bigger.
  for (const x of [400, 720, 1040]) {
    for (const y of [180, 370, 560]) {
      const placed = placePopup(natural, { x, y }, wide, shown);
      assert.ok(isWorthShowing(placed, shown), `pointer at ${x},${y}: ${placed.side} ${placed.width}×${placed.height}`);
    }
  }
});

test('placePopup has nowhere to go in a window too small', () => {
  assert.equal(placePopup({ width: 100, height: 100 }, { x: 5, y: 5 }, { width: 10, height: 10 }), null);
});

test('isWorthShowing wants the popup clearly bigger than the page shows it', () => {
  assert.equal(isWorthShowing({ width: 400, height: 300 }, { width: 200, height: 150 }), true);
  assert.equal(isWorthShowing({ width: 210, height: 160 }, { width: 200, height: 150 }), false);
  // A square crop of a wide image: the popup is much wider.
  assert.equal(isWorthShowing({ width: 450, height: 150 }, { width: 150, height: 150 }), true);
  // Nothing on the page to compare with, as for a text link.
  assert.equal(isWorthShowing({ width: 100, height: 100 }, null), true);
});
