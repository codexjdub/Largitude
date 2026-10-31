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
const { SITES, fullSizeUrls } = context;
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
    assert.ok(site.gallery === undefined || typeof site.gallery === 'function', site.name);
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

test('other sites are left alone', () => {
  assert.deepEqual(plain(fullSizeUrls('https://example.com/photo.jpg?name=small')), []);
  assert.deepEqual(plain(fullSizeUrls('not a url')), []);
});
