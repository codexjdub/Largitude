// Unit tests for how extension/settings.js stores the settings, loaded the way the extension loads it: after
// helpers.js, as plain scripts whose function declarations become globals, with a stand-in for the storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL });
for (const file of ['helpers.js', 'settings.js']) {
  vm.runInContext(readFileSync(new URL('../extension/' + file, import.meta.url), 'utf8'), context, { filename: file });
}
const { storedItems, optionsFrom, readOptions, saveOptions } = context;
// Objects made inside the context have its own Object prototype, which deepEqual tells apart.
const plain = (value) => JSON.parse(JSON.stringify(value));

// browser.storage's sync and local areas, holding `sync` and `local`, which keep each write's item names.
function storage(sync = {}, local = {}) {
  const area = (items) => ({
    items,
    writes: [],
    async get(names) {
      const wanted = names === null ? Object.keys(items) : [].concat(names);
      return structuredClone(Object.fromEntries(wanted.filter((name) => name in items).map((name) => [name, items[name]])));
    },
    async set(values) {
      this.writes.push(Object.keys(values).sort());
      Object.assign(items, structuredClone(values));
    },
    async remove(names) {
      this.writes.push([].concat(names).map((name) => '-' + name));
      [].concat(names).forEach((name) => delete items[name]);
    },
  });
  context.browser = { storage: { sync: area(sync), local: area(local) } };
  return context.browser.storage;
}

test('each site to leave alone is an item of its own, holding its place, and they come back in order', () => {
  const options = { excluded: 'news.example.org\nexample.com', hoverDelay: 'long', galleryWheelReversed: true, keysUnderPopup: false };
  const items = storedItems(options);
  assert.deepEqual(plain(items), {
    options: { hoverDelay: 'long', galleryWheelReversed: true, keysUnderPopup: false },
    'site:news.example.org': 0,
    'site:example.com': 1,
  });
  assert.deepEqual(plain(optionsFrom(items)), options);
  // An entry typed twice is one item.
  assert.deepEqual(Object.keys(storedItems({ excluded: 'example.com, other.net example.com' })), ['options', 'site:example.com', 'site:other.net']);
});

test('sites synced from two computers, in the same places, are all kept', () => {
  const items = { options: {}, 'site:b.example': 0, 'site:a.example': 0, 'site:c.example': 1 };
  assert.equal(optionsFrom(items).excluded, 'a.example\nb.example\nc.example');
});

test('nothing stored, or settings from before a setting existed, read as the defaults', () => {
  assert.deepEqual(plain(optionsFrom({})), { excluded: '', hoverDelay: 'normal', galleryWheelReversed: false, keysUnderPopup: true });
  assert.equal(optionsFrom({ options: { galleryWheelReversed: true } }).hoverDelay, 'normal');
});

test('saving writes only the sites that are new or moved, and takes off only those gone from the list', async () => {
  const { sync } = storage();
  await saveOptions({ excluded: 'a.example\nb.example\nc.example', hoverDelay: 'normal' });
  sync.writes.length = 0;
  await saveOptions({ excluded: 'a.example\nb.example\nd.example', hoverDelay: 'normal' });
  assert.deepEqual(sync.writes, [['-site:c.example'], ['options', 'site:d.example']]);
  assert.equal((await readOptions()).excluded, 'a.example\nb.example\nd.example');
});

test("a site another save adds meanwhile isn't taken off", async () => {
  const { sync } = storage();
  await saveOptions({ excluded: 'a.example\nb.example' });
  // The settings page saves a list without b.example while the toolbar button adds c.example: the button's
  // write lands between the page's reading the stored items and its own writes.
  const get = sync.get;
  sync.get = async (names) => {
    const before = await get.call(sync, names);
    sync.get = get;
    await saveOptions({ excluded: 'a.example\nb.example\nc.example' });
    return before;
  };
  await saveOptions({ excluded: 'a.example' });
  assert.equal((await readOptions()).excluded, 'a.example\nc.example');
});

test('until they move to the synced storage, the settings are read where they were', async () => {
  storage({}, { options: { excluded: 'example.com', galleryWheelReversed: true } });
  assert.deepEqual(plain(await readOptions()), { excluded: 'example.com', hoverDelay: 'normal', galleryWheelReversed: true, keysUnderPopup: true });
  storage({ options: { hoverDelay: 'long' }, 'site:other.net': 0 }, { options: { excluded: 'example.com' } });
  assert.equal((await readOptions()).excluded, 'other.net');
});
