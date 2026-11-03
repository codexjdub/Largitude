// Largitude's background script: gives each frame the settings that apply to it, saves the image the popup
// shows when the user presses S, opens it in a tab for O or fetches it for C where the popup can't read it, and
// runs the toolbar button.
//
// isExcluded, pageHostOf, listWithSite, listWithoutSite and hoverDelayOf come from helpers.js; DEFAULT_OPTIONS,
// readOptions, optionsFrom and saveOptions from settings.js, both loaded first.

// Until 0.8.0, the settings were kept on this computer only. The first time a later version runs, they move to
// the synced storage: this computer's sites to leave alone go after any another computer has synced there
// already, whose other choices are kept. Until the move is done, readOptions reads them where they were.
async function moveToSync() {
  const { options } = await browser.storage.local.get('options');
  if (!options) return;
  const stored = await browser.storage.sync.get(null);
  const synced = optionsFrom(stored);
  const moved = stored.options
    ? { ...synced, excluded: synced.excluded + '\n' + (options.excluded || '') }
    : { ...DEFAULT_OPTIONS, ...options };
  await saveOptions(moved);
  await browser.storage.local.remove('options');
}

const moving = moveToSync().catch(() => {});

// The settings, once any from before 0.8.0 have moved.
async function loadOptions() {
  await moving;
  return readOptions();
}

async function settingsFor(sender) {
  const { excluded, hoverDelay, galleryWheelReversed, keysUnderPopup } = await loadOptions();
  return {
    // The tab's page counts as well as the frame's own address, so a frame embedded on a site to leave alone is
    // left alone too.
    excluded: [sender.tab && sender.tab.url, sender.url].some((url) => !!url && isExcluded(excluded, url)),
    delay: hoverDelayOf(hoverDelay),
    reverseWheel: !!galleryWheelReversed,
    keysUnder: !!keysUnderPopup,
  };
}

// Firefox's own setting decides whether to ask where to save. A private window's download stays private.
async function save(message, sender) {
  if (typeof message.url !== 'string' || !/^https?:/i.test(message.url)) return 'failed';
  const download = { url: message.url, conflictAction: 'uniquify', incognito: !!(sender.tab && sender.tab.incognito) };
  if (typeof message.filename === 'string' && message.filename) download.filename = message.filename;
  try {
    await browser.downloads.download(download);
    return 'saved';
  } catch (err) {
    return /cancel/i.test(String(err && err.message)) ? 'canceled' : 'failed';
  }
}

// O: the image or video in a new tab, right after the one it's on, in the same window.
async function openTab(message, sender) {
  if (typeof message.url !== 'string' || !/^https?:/i.test(message.url) || !sender.tab) return false;
  try {
    await browser.tabs.create({ url: message.url, index: sender.tab.index + 1, windowId: sender.tab.windowId, openerTabId: sender.tab.id });
    return true;
  } catch (err) {
    return false;
  }
}

// C, where the popup can't read the image it shows: the image's file, which the background script can fetch from
// any site. Without cookies and kept out of the cache, which is the normal window's: an image copied in a private
// window would otherwise stay there.
async function imageFile(message) {
  if (typeof message.url !== 'string' || !/^https?:/i.test(message.url)) return null;
  try {
    const response = await fetch(message.url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return null;
    return { type: response.headers.get('content-type') || '', bytes: await response.arrayBuffer() };
  } catch (err) {
    return null;
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'settings') return settingsFor(sender);
  if (message && message.type === 'save') return save(message, sender);
  if (message && message.type === 'open') return openTab(message, sender);
  if (message && message.type === 'image') return imageFile(message);
  return undefined;
});

// ---- The toolbar button ----

// A click turns Largitude off on the tab's site, by adding the site to the sites to leave alone, or back on, by
// taking off the list whatever entries cover it. Pages already open follow at once, as for any change to the
// settings.
browser.action.onClicked.addListener(async (tab) => {
  if (!pageHostOf(tab.url)) return;
  const options = await loadOptions();
  const excluded = isExcluded(options.excluded, tab.url)
    ? listWithoutSite(options.excluded, tab.url)
    : listWithSite(options.excluded, tab.url);
  try {
    await saveOptions({ ...options, excluded });
  } catch (err) {
    // As when Firefox's limit of synced items is reached: the button says so on this tab.
    await Promise.all([
      browser.action.setBadgeText({ tabId: tab.id, text: '!' }),
      browser.action.setTitle({ tabId: tab.id, title: "Largitude couldn't save the change" }),
    ]).catch(() => {});
  }
});

// The button shows "off" on a tab whose site is left alone, and says what a click will do. On pages Largitude
// doesn't work on (about:, file:), it's grayed out.
function showState(tab, excluded) {
  const host = pageHostOf(tab.url);
  const off = !!host && isExcluded(excluded, tab.url);
  const title = !host ? 'Largitude' : off ? `Largitude is off on ${host}: click to turn it on` : `Turn Largitude off on ${host}`;
  const calls = [
    host ? browser.action.enable(tab.id) : browser.action.disable(tab.id),
    browser.action.setBadgeText({ tabId: tab.id, text: off ? 'off' : '' }),
    browser.action.setTitle({ tabId: tab.id, title }),
  ];
  // A tab can close before its state is set.
  return Promise.all(calls).catch(() => {});
}

// The sites to leave alone, kept for the button's state on each tab's every change, and read again when the
// settings change.
let excludedNow = null;

async function showAllStates() {
  const [{ excluded }, tabs] = await Promise.all([loadOptions(), browser.tabs.query({})]);
  excludedNow = excluded;
  await Promise.all(tabs.map((tab) => showState(tab, excluded)));
}

browser.action.setBadgeBackgroundColor({ color: '#5d6066' });
browser.tabs.onUpdated.addListener(
  async (tabId, change, tab) => {
    if (excludedNow === null) excludedNow = (await loadOptions()).excluded;
    return showState(tab, excludedNow);
  },
  { properties: ['url', 'status'] }
);
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  excludedNow = null;
  showAllStates();
});
browser.runtime.onStartup.addListener(showAllStates);
browser.runtime.onInstalled.addListener(showAllStates);
