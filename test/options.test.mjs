// Unit tests for the settings page, extension/options.js, loaded as options.html loads it: after helpers.js and
// settings.js, with stand-ins for the page's fields and the synced storage, each test in a new copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = ['helpers.js', 'settings.js', 'options.js'].map((file) => [
  file,
  readFileSync(new URL('../extension/' + file, import.meta.url), 'utf8'),
]);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// The page, with `sync` stored. change() is a field's change event, which saves; elsewhere() is a change from
// Firefox Sync or the toolbar button.
async function open(sync = {}) {
  const changeListeners = [];
  const storageListeners = [];
  let delay = 'normal';
  const fields = {
    excluded: { value: '' },
    hoverDelay: {
      get value() {
        return delay;
      },
      // A select takes only the values of its options.
      set value(value) {
        delay = ['short', 'normal', 'long'].includes(value) ? value : '';
      },
    },
    galleryWheelReversed: { checked: false },
    keysUnderPopup: { checked: false },
    status: { textContent: '' },
    options: { addEventListener: (type, listener) => type === 'change' && changeListeners.push(listener) },
  };
  const document = { activeElement: null, getElementById: (id) => fields[id] };
  const tell = () => storageListeners.forEach((listener) => listener({}, 'sync'));
  const items = sync;
  const area = {
    async get() {
      return structuredClone(items);
    },
    async set(values) {
      Object.assign(items, structuredClone(values));
      tell();
    },
    async remove(names) {
      [].concat(names).forEach((name) => delete items[name]);
      tell();
    },
  };
  const browser = {
    storage: {
      sync: area,
      local: { get: async () => ({}) },
      onChanged: { addListener: (listener) => storageListeners.push(listener) },
    },
  };
  const timer = (fn, ms) => setTimeout(fn, ms).unref();
  const context = vm.createContext({ URL, TextEncoder, document, browser, setTimeout: timer });
  for (const [file, code] of files) vm.runInContext(code, context, { filename: file });
  await tick();
  return {
    fields,
    document,
    items,
    change: async () => {
      await Promise.all(changeListeners.map((listener) => listener()));
      await tick();
    },
    elsewhere: async (values) => {
      Object.assign(items, values);
      tell();
      await tick();
    },
  };
}

test('the page shows the stored settings, and saves each change', async () => {
  const page = await open({ options: { hoverDelay: 'long', keysUnderPopup: true }, 'site:a.example': 0 });
  assert.equal(page.fields.excluded.value, 'a.example');
  assert.equal(page.fields.hoverDelay.value, 'long');
  assert.equal(page.fields.keysUnderPopup.checked, true);
  page.fields.excluded.value = 'a.example, b.example';
  page.fields.galleryWheelReversed.checked = true;
  await page.change();
  assert.equal(page.items['site:b.example'], 1);
  assert.equal(page.items.options.galleryWheelReversed, true);
  assert.equal(page.fields.excluded.value, 'a.example\nb.example');
  assert.equal(page.fields.status.textContent, 'Saved.');
});

test('a change from elsewhere leaves the list being edited alone, and the edit is saved on top of it', async () => {
  const page = await open({ options: {}, 'site:a.example': 0, 'site:b.example': 1 });
  const list = page.fields.excluded;
  // The user is typing: b.example off, c.example on.
  page.document.activeElement = list;
  list.value = 'a.example\nc.exam';
  // Meanwhile, the toolbar button adds d.example, and another computer's change turns the wheel around.
  await page.elsewhere({ 'site:d.example': 2, options: { galleryWheelReversed: true } });
  assert.equal(list.value, 'a.example\nc.exam');
  assert.equal(page.fields.galleryWheelReversed.checked, true);
  list.value = 'a.example\nc.example';
  page.document.activeElement = null;
  await page.change();
  assert.equal(list.value, 'a.example\nc.example\nd.example');
  assert.ok(!('site:b.example' in page.items));
  // With the list not being edited, a change from elsewhere shows at once.
  await page.elsewhere({ 'site:e.example': 3 });
  assert.equal(list.value, 'a.example\nc.example\nd.example\ne.example');
});

test("a list Firefox can't hold isn't saved, stays as typed, and the page says why", async () => {
  const page = await open({ options: {} });
  const list = page.fields.excluded;
  list.value = Array.from({ length: 512 }, (_, i) => `s${i}.example`).join('\n');
  await page.change();
  assert.equal(page.fields.status.textContent, "Couldn't save: Firefox keeps 511 sites to leave alone at most.");
  assert.deepEqual(Object.keys(page.items), ['options']);
  assert.equal(list.value.split('\n').length, 512);
  list.value = 'x'.repeat(9000) + '.example';
  await page.change();
  assert.equal(page.fields.status.textContent, "Couldn't save: the list is longer than Firefox's synced storage holds.");
});
