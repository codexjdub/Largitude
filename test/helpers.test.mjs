// Unit tests for extension/helpers.js, loaded the way the extension loads it: as a plain script, whose
// function declarations become globals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL });
vm.runInContext(readFileSync(new URL('../extension/helpers.js', import.meta.url), 'utf8'), context, { filename: 'helpers.js' });
const {
  hostOf,
  isExcluded,
  pageHostOf,
  listWithSite,
  listWithoutSite,
  parseSrcset,
  largestCandidate,
  isImageFileUrl,
  isVideoFileUrl,
  addSite,
  fullSizeUrls,
  fileNameFor,
  colorAlpha,
  placePopup,
  isWorthShowing,
  unturnedBox,
  turnInPlace,
} = context;
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

test('pageHostOf gives the host of web pages only', () => {
  assert.equal(pageHostOf('https://www.example.com/a?b'), 'www.example.com');
  assert.equal(pageHostOf('http://localhost:8766/test/'), 'localhost');
  assert.equal(pageHostOf('about:addons'), '');
  assert.equal(pageHostOf('file:///Users/someone/photo.jpg'), '');
  assert.equal(pageHostOf('moz-extension://abc/options.html'), '');
  assert.equal(pageHostOf(undefined), '');
});

test('the toolbar button adds the site of a page to the list, without www.', () => {
  assert.equal(listWithSite('', 'https://www.example.com/page'), 'example.com');
  assert.equal(listWithSite('a.org\n\n', 'https://news.example.com/'), 'a.org\nnews.example.com');
  assert.equal(listWithSite(undefined, 'https://example.com/'), 'example.com');
  // Already left alone, or not a web page: the list stays as it is.
  assert.equal(listWithSite('example.com', 'https://img.example.com/'), 'example.com');
  assert.equal(listWithSite('a.org', 'about:blank'), 'a.org');
  assert.equal(isExcluded(listWithSite('a.org', 'https://www.example.com/'), 'https://example.com/'), true);
});

test('the toolbar button, clicked again, takes off every entry that covers the page', () => {
  const list = 'a.org\nexample.com, https://www.example.com/page\n*.cdn.net';
  assert.equal(listWithoutSite(list, 'https://www.example.com/other'), 'a.org\n*.cdn.net');
  assert.equal(isExcluded(listWithoutSite(list, 'https://www.example.com/'), 'https://www.example.com/'), false);
  assert.equal(listWithoutSite(list, 'https://x.cdn.net/'), 'a.org\nexample.com\nhttps://www.example.com/page');
  assert.equal(listWithoutSite('', 'https://example.com/'), '');
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
  assert.equal(isImageFileUrl('https://example.com/clip.mp4'), false);
});

test('isVideoFileUrl goes by the extension of the path, for the types Firefox plays', () => {
  assert.equal(isVideoFileUrl('https://example.com/clips/cat.MP4'), true);
  assert.equal(isVideoFileUrl('https://video.twimg.com/tweet_video/GaBcDeF.mp4?tag=12'), true);
  assert.equal(isVideoFileUrl('https://example.com/a.webm'), true);
  assert.equal(isVideoFileUrl('https://example.com/a.m4v'), true);
  assert.equal(isVideoFileUrl('https://example.com/a.ogv'), true);
  // GIFV is a page that plays a video, not a video; a site rule knows the file behind it.
  assert.equal(isVideoFileUrl('https://i.imgur.com/AbC.gifv'), false);
  assert.equal(isVideoFileUrl('https://example.com/cat.jpg'), false);
  assert.equal(isVideoFileUrl('blob:https://example.com/1234'), false);
  assert.equal(isVideoFileUrl('nonsense'), false);
});

// The real sites' rules are tried in sites.test.mjs; these made-up ones try the way they're run.
test('fullSizeUrls runs every rule that matches, in order, without repeats or unchanged addresses', () => {
  const small = /^https:\/\/a\.test\/small\/(\w+)\.jpg$/;
  addSite({
    name: 'A',
    larger: [
      [small, 'https://a.test/large/$1.jpg'],
      [small, (match, name) => 'https://a.test/original/' + name + '.png'],
    ],
  });
  addSite({
    name: 'B',
    larger: [
      [/^(https:\/\/a\.test\/)small\/(\w+\.jpg)$/, '$1large/$2'],
      [/^https:\/\/a\.test\/small\//, (match) => match],
    ],
  });
  addSite({ name: 'C, galleries only', gallery: () => null });
  assert.deepEqual(plain(fullSizeUrls('https://a.test/small/cat.jpg')), ['https://a.test/large/cat.jpg', 'https://a.test/original/cat.png']);
  assert.deepEqual(plain(fullSizeUrls('https://b.test/small/cat.jpg')), []);
  assert.deepEqual(plain(fullSizeUrls(undefined)), []);
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

test('colorAlpha reads the opacity of the colors getComputedStyle gives', () => {
  assert.equal(colorAlpha('rgb(255, 255, 255)'), 1);
  assert.equal(colorAlpha('rgba(0, 0, 0, 0)'), 0);
  assert.equal(colorAlpha('rgba(0, 0, 0, 0.3)'), 0.3);
  assert.equal(colorAlpha('rgb(1 2 3 / 25%)'), 0.25);
  // Newer syntaxes, which the browser doesn't turn into rgb().
  assert.equal(colorAlpha('oklch(0.98 0 0)'), 1);
  assert.equal(colorAlpha('oklch(0.98 0 0 / 0.4)'), 0.4);
  assert.equal(colorAlpha('color(display-p3 1 1 1)'), 1);
  assert.equal(colorAlpha('color(srgb 0.5 0.5 0.5 / 50%)'), 0.5);
  assert.equal(colorAlpha('lab(50 20 30 / none)'), 0);
  assert.equal(colorAlpha('transparent'), 0);
  assert.equal(colorAlpha(''), 0);
  assert.equal(colorAlpha(undefined), 0);
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

test('placePopup keeps room under the popup, between it and the pointer when it goes above', () => {
  const view = { width: 1280, height: 800 };
  const under = 32;
  // Beside the pointer, a tall image is fitted shorter, and the room under it stays inside the window.
  const beside = placePopup({ width: 1000, height: 2000 }, { x: 200, y: 400 }, view, null, under);
  assert.equal(beside.side, 'right');
  assert.equal(beside.height, 800 - 16 - under);
  assert.ok(beside.top + beside.height + under <= 800 - 8);
  // Below the pointer, the same.
  const below = placePopup({ width: 2400, height: 1200 }, { x: 640, y: 100 }, view, null, under);
  assert.equal(below.side, 'below');
  assert.ok(below.top + below.height + under <= 800 - 8);
  // Above the pointer, the room is between the popup and the pointer.
  const above = placePopup({ width: 2400, height: 1200 }, { x: 640, y: 700 }, view, null, under);
  assert.equal(above.side, 'above');
  assert.equal(above.top + above.height + under, 700 - 16);
  // Covering the window, centered with the room counted in.
  const cover = placePopup({ width: 1600, height: 1200 }, { x: 600, y: 400 }, { width: 1200, height: 800 }, null, under);
  assert.equal(cover.side, 'cover');
  assert.equal(cover.height, 800 - 16 - under);
  assert.equal(cover.top, Math.round((800 - under - cover.height) / 2));
  // Without room asked for, nothing changes.
  assert.deepEqual(plain(placePopup({ width: 1000, height: 2000 }, { x: 200, y: 400 }, view, null, 0)), plain(placePopup({ width: 1000, height: 2000 }, { x: 200, y: 400 }, view)));
});

test('isWorthShowing wants the popup clearly bigger than the page shows it', () => {
  assert.equal(isWorthShowing({ width: 400, height: 300 }, { width: 200, height: 150 }), true);
  assert.equal(isWorthShowing({ width: 210, height: 160 }, { width: 200, height: 150 }), false);
  // A square crop of a wide image: the popup is much wider.
  assert.equal(isWorthShowing({ width: 450, height: 150 }, { width: 150, height: 150 }), true);
  // Nothing on the page to compare with, as for a text link.
  assert.equal(isWorthShowing({ width: 100, height: 100 }, null), true);
});

test('unturnedBox swaps the sides for a quarter turn, keeping the middle', () => {
  const box = { left: 0, top: 0, width: 400, height: 300 };
  assert.deepEqual(plain(unturnedBox(box, 1)), { left: 50, top: -50, width: 300, height: 400 });
  assert.deepEqual(plain(unturnedBox(box, 3)), { left: 50, top: -50, width: 300, height: 400 });
  assert.deepEqual(plain(unturnedBox(box, 2)), box);
  assert.deepEqual(plain(unturnedBox(box, 0)), box);
  // At actual size, the part of the window the turned image takes: off the window's left and top.
  assert.deepEqual(plain(unturnedBox({ left: -200, top: -800, width: 1200, height: 1600 }, 1)), { left: -400, top: -600, width: 1600, height: 1200 });
});

test('turnInPlace turns the popup about its middle, keeping its size', () => {
  const view = { width: 1200, height: 800 };
  const box = { left: 300, top: 200, width: 400, height: 300 };
  assert.deepEqual(plain(turnInPlace(box, 1, view)), { left: 350, top: 150, width: 300, height: 400 });
  assert.deepEqual(plain(turnInPlace(box, 3, view)), { left: 350, top: 150, width: 300, height: 400 });
  // A half turn, and four, leave it as it was.
  assert.deepEqual(plain(turnInPlace(box, 2, view)), box);
  assert.deepEqual(plain(turnInPlace(box, 0, view)), box);
});

test('turnInPlace shrinks the popup to fit the window, and moves it only to stay inside', () => {
  const view = { width: 1200, height: 800 };
  // Wide and filling the window's width: turned, it's too tall, so it shrinks, keeping its shape and middle.
  const wide = { left: 8, top: 175, width: 1184, height: 450 };
  const turned = turnInPlace(wide, 1, view);
  assert.equal(turned.height, 784);
  assert.ok(Math.abs(turned.width - (784 * 450) / 1184) <= 1);
  assert.equal(turned.top, 8);
  assert.ok(Math.abs(turned.left + turned.width / 2 - 600) <= 1);
  // Near the window's right edge: moved left, just inside.
  const edge = turnInPlace({ left: 1000, top: 300, width: 192, height: 300 }, 1, view);
  assert.equal(edge.left + edge.width, 1200 - 8);
  assert.equal(edge.width, 300);
  assert.equal(edge.top, 354);
  // With room kept below for the line of keys.
  const low = turnInPlace({ left: 100, top: 500, width: 400, height: 292 }, 1, view, 32);
  assert.ok(low.top + low.height + 32 <= 800 - 8);
});
