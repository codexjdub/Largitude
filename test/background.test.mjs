// Unit tests for extension/background.js, loaded the way Firefox loads the background script: after helpers.js
// and settings.js, as plain scripts, with stand-ins for the extension APIs it uses, each test in a new copy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const files = ['helpers.js', 'settings.js', 'background.js'].map((file) => [
  file,
  readFileSync(new URL('../extension/' + file, import.meta.url), 'utf8'),
]);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
// Objects made inside the context have its own Object prototype, which deepEqual tells apart.
const plain = (value) => JSON.parse(JSON.stringify(value));

// An event's listeners, and a way to call them.
function event() {
  const listeners = [];
  return { listeners, addListener: (listener) => listeners.push(listener), fire: (...args) => listeners.map((listener) => listener(...args)) };
}

// The background script, started with `sync` and `local` stored. `fetched` gives the file at an address, as
// { type, body }; `download` stands in for downloads.download.
function start({ sync = {}, local = {}, fetched = {}, download = async () => 1 } = {}) {
  const onChanged = event();
  const reads = [];
  const area = (name, items) => ({
    items,
    async get(names) {
      reads.push(name);
      const wanted = names === null ? Object.keys(items) : [].concat(names);
      return structuredClone(Object.fromEntries(wanted.filter((key) => key in items).map((key) => [key, items[key]])));
    },
    async set(values) {
      Object.assign(items, structuredClone(values));
      queueMicrotask(() => onChanged.fire(values, name));
    },
    async remove(names) {
      [].concat(names).forEach((key) => delete items[key]);
      queueMicrotask(() => onChanged.fire({}, name));
    },
  });
  const badges = {};
  const titles = {};
  const downloads = [];
  const opened = [];
  const fetches = [];
  const browser = {
    storage: { sync: area('sync', sync), local: area('local', local), onChanged },
    runtime: { onMessage: event(), onStartup: event(), onInstalled: event() },
    action: {
      onClicked: event(),
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ tabId, text }) => (badges[tabId] = text),
      setTitle: async ({ tabId, title }) => (titles[tabId] = title),
      enable: async () => {},
      disable: async () => {},
    },
    tabs: { onUpdated: event(), query: async () => [], create: async (tab) => opened.push(tab) },
    downloads: {
      download: async (options) => {
        downloads.push({ ...options });
        return download(options);
      },
    },
  };
  // Long timers, such as the minute a file's own address is kept, don't hold the tests up.
  const timer = (fn, ms, ...args) => {
    const id = setTimeout(fn, ms, ...args);
    if (ms >= 1000) id.unref();
    return id;
  };
  const context = vm.createContext({
    URL,
    Blob,
    TextEncoder,
    AbortController,
    Headers,
    browser,
    setTimeout: timer,
    clearTimeout,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      const file = fetched[url];
      if (!file) return { ok: false, status: 404, headers: new Headers() };
      return { ok: true, headers: new Headers({ 'content-type': file.type }), arrayBuffer: async () => new TextEncoder().encode(file.body || '').buffer };
    },
  });
  for (const [file, code] of files) vm.runInContext(code, context, { filename: file });
  const send = (message, sender = {}) => browser.runtime.onMessage.listeners[0](message, sender);
  return { browser, context, reads, badges, titles, downloads, opened, fetches, send };
}

const tab = (url, more = {}) => ({ id: 7, index: 2, windowId: 1, url, incognito: false, ...more });

test('settings from before 0.8.0 move to the synced storage, after any another computer synced there', async () => {
  let bg = start({ local: { options: { excluded: 'example.com\nother.net', galleryWheelReversed: true } } });
  await tick();
  assert.deepEqual(plain(bg.browser.storage.local.items), {});
  assert.deepEqual(plain(bg.browser.storage.sync.items), {
    options: { hoverDelay: 'normal', galleryWheelReversed: true, keysUnderPopup: true },
    'site:example.com': 0,
    'site:other.net': 1,
  });
  // Another computer's choices are kept, and its sites come first.
  bg = start({
    sync: { options: { hoverDelay: 'long', galleryWheelReversed: false }, 'site:synced.example': 0 },
    local: { options: { excluded: 'example.com', galleryWheelReversed: true } },
  });
  await tick();
  const settings = await bg.send({ type: 'settings' }, { url: 'https://example.com/', tab: tab('https://example.com/') });
  assert.deepEqual(plain(settings), { excluded: true, delay: 700, reverseWheel: false, keysUnder: true });
  assert.equal(bg.browser.storage.sync.items['site:synced.example'], 0);
  assert.equal(bg.browser.storage.sync.items['site:example.com'], 1);
  assert.deepEqual(plain(bg.browser.storage.local.items), {});
});

test("a frame's settings: left alone by its own address or its tab's, and read once for every frame", async () => {
  const bg = start({ sync: { options: { hoverDelay: 'short' }, 'site:news.example': 0 } });
  await tick();
  const frame = (url, page) => bg.send({ type: 'settings' }, { url, tab: tab(page) });
  assert.equal((await frame('https://ads.example/', 'https://news.example/today')).excluded, true);
  assert.equal((await frame('https://news.example/embed', 'https://blog.example/')).excluded, true);
  const other = await frame('https://blog.example/', 'https://blog.example/');
  assert.deepEqual(plain(other), { excluded: false, delay: 100, reverseWheel: false, keysUnder: true });
  const reads = bg.reads.filter((name) => name === 'sync').length;
  await frame('https://blog.example/2', 'https://blog.example/2');
  assert.equal(bg.reads.filter((name) => name === 'sync').length, reads);
});

test('frames that hear the settings changed get them as changed, even before the background script hears it', async () => {
  const bg = start({ sync: { options: {} } });
  await tick();
  const sender = { url: 'https://blog.example/', tab: tab('https://blog.example/') };
  assert.equal((await bg.send({ type: 'settings' }, sender)).excluded, false);
  // The settings page saves, and a frame asks before the background script's own listener has run.
  bg.browser.storage.sync.items['site:blog.example'] = 0;
  const asked = [bg.send({ type: 'settings', changed: true }, sender), bg.send({ type: 'settings', changed: true }, sender)];
  assert.deepEqual((await Promise.all(asked)).map((settings) => settings.excluded), [true, true]);
  // One read for both, and the frames that ask afterwards get it too.
  assert.equal((await bg.send({ type: 'settings' }, sender)).excluded, true);
});

test('the toolbar button turns Largitude off on a site, and back on, and says when it can\'t', async () => {
  const bg = start({ sync: { options: {} } });
  await tick();
  const click = async (page) => {
    await bg.browser.action.onClicked.listeners[0](page);
    await tick();
  };
  await click(tab('https://www.example.com/page'));
  assert.equal(bg.browser.storage.sync.items['site:example.com'], 0);
  await click(tab('https://shop.example.com/'));
  assert.ok(!('site:example.com' in bg.browser.storage.sync.items));
  // Pages Largitude doesn't work on are left alone.
  await click(tab('about:addons'));
  assert.deepEqual(Object.keys(bg.browser.storage.sync.items), ['options']);
  // A list Firefox can't hold more of: nothing changes, and the button says so on that tab.
  for (let i = 0; i < 511; i++) bg.browser.storage.sync.items[`site:s${i}.example`] = i;
  bg.browser.storage.onChanged.fire({}, 'sync');
  await click(tab('https://full.example/', { id: 9 }));
  assert.ok(!('site:full.example' in bg.browser.storage.sync.items));
  assert.equal(bg.badges[9], '!');
  assert.equal(bg.titles[9], "Largitude couldn't save the change");
});

test('S saves the file under its name, with the type the server gives when the name has none', async () => {
  const bg = start({ fetched: { 'https://lh3.googleusercontent.com/AbCd=s0': { type: 'image/webp' } } });
  const sender = { tab: tab('https://example.com/', { incognito: true }) };
  const saved = (message) => bg.send({ type: 'save', ...message }, sender).then(plain);
  assert.deepEqual(await saved({ url: 'https://i.redd.it/abc.png', filename: 'abc.png' }), { result: 'saved', name: 'abc.png' });
  // The answer has the name it was saved under, for the popup's note.
  assert.deepEqual(await saved({ url: 'https://lh3.googleusercontent.com/AbCd=s0', filename: 'AbCd=s0' }), { result: 'saved', name: 'AbCd=s0.webp' });
  assert.deepEqual(
    bg.downloads.map(({ url, filename, incognito }) => ({ url, filename, incognito })),
    [
      { url: 'https://i.redd.it/abc.png', filename: 'abc.png', incognito: true },
      { url: 'https://lh3.googleusercontent.com/AbCd=s0', filename: 'AbCd=s0.webp', incognito: true },
    ]
  );
  // Only the name without a type was asked about, without cookies and out of the cache.
  assert.deepEqual(plain(bg.fetches.map(({ url, init }) => [url, init.credentials, init.cache])), [
    ['https://lh3.googleusercontent.com/AbCd=s0', 'omit', 'no-store'],
  ]);
});

test('S: a name Firefox refuses leaves the name to Firefox; a canceled save is no failure', async () => {
  const bg = start({
    download: async (options) => {
      if (options.filename === 'shortcut.url') throw new Error('filename must not contain illegal characters');
      if (options.filename === 'ask.jpg') throw new Error('Download canceled by the user');
      return 1;
    },
  });
  const saved = (message) => bg.send({ type: 'save', ...message }, {}).then(plain);
  // Named by Firefox, so the answer has no name.
  assert.deepEqual(await saved({ url: 'https://example.com/shortcut.url', filename: 'shortcut.url' }), { result: 'saved', name: '' });
  assert.deepEqual(bg.downloads.map((download) => download.filename), ['shortcut.url', undefined]);
  assert.equal((await saved({ url: 'https://example.com/ask.jpg', filename: 'ask.jpg' })).result, 'canceled');
  assert.equal((await saved({ url: 'javascript:alert(1)', filename: 'x.png' })).result, 'failed');
});

test("S and O: the page's own data: and blob: files, which the content script sends, are saved and opened", async () => {
  const bg = start();
  const bytes = vm.runInContext('new Uint8Array([137, 80, 78, 71]).buffer', bg.context);
  const file = { type: 'image/png', bytes };
  const sender = { tab: tab('https://chat.example/') };
  assert.deepEqual(plain(await bg.send({ type: 'save', url: 'blob:https://chat.example/1234', filename: '', file }, sender)), { result: 'saved', name: 'image.png' });
  assert.match(bg.downloads[0].url, /^blob:/);
  assert.equal(bg.downloads[0].filename, 'image.png');
  assert.equal(await bg.send({ type: 'open', url: 'data:image/png;base64,iVBORw0KGgo=', file }, sender), true);
  assert.match(bg.opened[0].url, /^blob:/);
  assert.equal(bg.opened[0].index, 3);
  // Without the file, such an address can't be saved or opened.
  assert.equal((await bg.send({ type: 'save', url: 'blob:https://chat.example/1234', filename: '' }, sender)).result, 'failed');
  assert.equal(await bg.send({ type: 'open', url: 'data:image/png;base64,iVBORw0KGgo=' }, sender), false);
});
