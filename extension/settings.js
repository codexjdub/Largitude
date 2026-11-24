// Largitude's settings: their starting values and where they're kept, shared by background.js and the settings
// page (options.js). They're kept in Firefox's synced storage, which Firefox Sync carries to the user's other
// computers where it syncs add-ons; otherwise it stays on this computer, like any storage. entriesOf comes from
// helpers.js, loaded first.

// galleryWheelReversed is stored under a new name since 0.4.1, where the wheel's usual direction changed: a choice
// made under 0.3.0's meaning would now do the opposite of what was chosen, so it's left behind.
const DEFAULT_OPTIONS = { excluded: '', hoverDelay: 'normal', galleryWheelReversed: false, keysUnderPopup: true };

// Each site to leave alone is a stored item of its own, named site:<the entry as typed> and holding its place in
// the list; the other settings are one item, options. Firefox Sync merges the items one by one, the incoming one
// winning where both computers changed it, so sites added on two computers are both kept, and a site taken off
// on one is taken off on the other. Firefox syncs at most 512 items, which leaves room for 511 sites, of at most
// 8,192 bytes each and 102,400 in all, counting each item's name and its value as JSON.
const SITE = 'site:';
const SYNC_MAX_ITEMS = 512;
const SYNC_MAX_ITEM_BYTES = 8192;
const SYNC_MAX_BYTES = 102400;
const MAX_SITES = SYNC_MAX_ITEMS - 1;

// Why Firefox's synced storage can't hold `items`, all it would hold once saved: 'sites' for too many, 'size' for
// too long, or '' when they fit.
function overLimit(items) {
  const names = Object.keys(items);
  if (names.length > SYNC_MAX_ITEMS) return 'sites';
  const encoder = new TextEncoder();
  let total = 0;
  for (const name of names) {
    const bytes = encoder.encode(name + JSON.stringify(items[name])).length;
    if (bytes > SYNC_MAX_ITEM_BYTES) return 'size';
    total += bytes;
  }
  return total > SYNC_MAX_BYTES ? 'size' : '';
}

// The items to store for `options`.
function storedItems(options) {
  const { excluded, ...others } = options;
  const items = { options: others };
  entriesOf(excluded).forEach((entry, place) => {
    if (!Object.hasOwn(items, SITE + entry)) items[SITE + entry] = place;
  });
  return items;
}

// The settings in the stored `items`, with the sites to leave alone in their places.
function optionsFrom(items) {
  const sites = Object.keys(items)
    .filter((name) => name.startsWith(SITE))
    .sort((a, b) => items[a] - items[b] || (a < b ? -1 : 1));
  return { ...DEFAULT_OPTIONS, ...items.options, excluded: sites.map((name) => name.slice(SITE.length)).join('\n') };
}

// The settings, from the synced storage, or from this computer's until they've moved there (moveToSync in
// background.js), as they were kept before 0.8.0.
async function readOptions() {
  const items = await browser.storage.sync.get(null);
  if (!items.options) {
    const { options } = await browser.storage.local.get('options');
    if (options) return { ...DEFAULT_OPTIONS, ...options };
  }
  return optionsFrom(items);
}

// Saves every setting, writing only the sites that are new or have moved, and taking off only the sites that were
// stored and aren't in the list now. A site added meanwhile by another save, such as the toolbar button's, stays.
// The sites taken off go first, and the rest in one write, so a page that hears of that write finds the list whole.
// Settings that Firefox can't hold change nothing: they're turned down before anything is written, with an error
// whose `limit` says why (overLimit), and should the write fail anyway, the sites taken off go back.
async function saveOptions(options) {
  const before = await browser.storage.sync.get(null);
  const items = storedItems(options);
  const gone = Object.keys(before).filter((name) => name.startsWith(SITE) && !Object.hasOwn(items, name));
  const changed = {};
  for (const name of Object.keys(items)) if (name === 'options' || before[name] !== items[name]) changed[name] = items[name];
  const after = { ...before, ...changed };
  gone.forEach((name) => delete after[name]);
  const limit = overLimit(after);
  if (limit) throw Object.assign(new Error(`Firefox's synced storage can't hold these settings (${limit})`), { limit });
  if (gone.length) await browser.storage.sync.remove(gone);
  try {
    await browser.storage.sync.set(changed);
  } catch (err) {
    if (gone.length) await browser.storage.sync.set(Object.fromEntries(gone.map((name) => [name, before[name]]))).catch(() => {});
    throw err;
  }
}
