// Largitude's background script: gives each frame the settings that apply to it, saves the image the popup
// shows when the user presses S, opens it in a tab for O or fetches it for C where the popup can't read it, and
// runs the toolbar button.
//
// isExcluded, pageHostOf, listWithSite, listWithoutSite, hoverDelayOf, hasMediaExtension and withExtension come
// from helpers.js; DEFAULT_OPTIONS, readOptions, optionsFrom and saveOptions from settings.js, both loaded first.

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

// The settings, once any from before 0.8.0 have moved. Every frame of every tab asks for them as it loads, and
// again when they change, so they're read once and kept until the next change (storage.onChanged below).
let reading = null;
function loadOptions() {
  if (!reading) {
    const read = moving.then(readOptions);
    reading = read;
    read.catch(() => {
      if (reading === read) reading = null;
    });
  }
  return reading;
}

// The settings for frames that have heard they changed, which may hear it before this script does: read afresh,
// once for all the frames that ask within a moment, and kept for the others. Each frame gets a read that started
// after it asked, so it has the change.
let nextRead = null;
function freshOptions() {
  if (!nextRead) {
    nextRead = new Promise((resolve) => setTimeout(resolve, 20)).then(() => {
      nextRead = null;
      reading = null;
      return loadOptions();
    });
  }
  return nextRead;
}

async function settingsFor(message, sender) {
  const options = await (message.changed ? freshOptions() : loadOptions());
  const { excluded, hoverDelay, galleryWheelReversed, keysUnderPopup } = options;
  return {
    // The tab's page counts as well as the frame's own address, so a frame embedded on a site to leave alone is
    // left alone too.
    excluded: [sender.tab && sender.tab.url, sender.url].some((url) => !!url && isExcluded(excluded, url)),
    delay: hoverDelayOf(hoverDelay),
    reverseWheel: !!galleryWheelReversed,
    keysUnder: !!keysUnderPopup,
  };
}

const isWebAddress = (url) => typeof url === 'string' && /^https?:/i.test(url);

// A file the content script sent, { type, bytes }, as an address of this script's own (blob:), which Firefox can
// download or show in a tab: the page's data: and blob: addresses are its own, out of this script's reach.
function ownAddress(file) {
  if (!file || Object.prototype.toString.call(file.bytes) !== '[object ArrayBuffer]') return '';
  return URL.createObjectURL(new Blob([file.bytes], { type: typeof file.type === 'string' ? file.type : '' }));
}

// The Content-Type of the file at `url`, from its headers, its body left unread; '' if the server doesn't say in
// time. Without cookies and kept out of the cache, as for C below.
async function typeAt(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    return response.ok ? response.headers.get('content-type') || '' : '';
  } catch (err) {
    return '';
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// S: the image or video, at its address, or the file the content script sent for an address of the page's own.
// Firefox's own setting decides whether to ask where to save. A private window's download stays private. A name
// without a type, as Google's photo=s0, gets the one the server gives. Firefox refuses a name it would have to
// change, such as one ending in .url, and then the file is saved under the name Firefox gives it. The answer is
// { result: 'saved', 'canceled' or 'failed', name }, the name the file was asked to have, '' if Firefox named it.
async function save(message, sender) {
  const own = isWebAddress(message.url) ? '' : ownAddress(message.file);
  if (!own && !isWebAddress(message.url)) return { result: 'failed', name: '' };
  const download = { url: own || message.url, conflictAction: 'uniquify', incognito: !!(sender.tab && sender.tab.incognito) };
  let name = typeof message.filename === 'string' ? message.filename : '';
  if (own) name = withExtension(/^video\//i.test(String(message.file.type)) ? 'video' : 'image', message.file.type);
  else if (name && !hasMediaExtension(name)) name = withExtension(name, await typeAt(message.url));
  if (name) download.filename = name;
  try {
    try {
      await browser.downloads.download(download);
    } catch (err) {
      if (!download.filename || /cancel/i.test(String(err && err.message))) throw err;
      delete download.filename;
      await browser.downloads.download(download);
    }
    return { result: 'saved', name: download.filename || '' };
  } catch (err) {
    return { result: /cancel/i.test(String(err && err.message)) ? 'canceled' : 'failed', name: '' };
  } finally {
    // The download has read the file by the time it's finished; Firefox lets go of its own address with this
    // script anyway.
    if (own) setTimeout(() => URL.revokeObjectURL(own), 60000);
  }
}

// O: the image or video in a new tab, right after the one it's on, in the same window: at its address, or the file
// the content script sent for an address of the page's own.
async function openTab(message, sender) {
  if (!sender.tab) return false;
  const own = isWebAddress(message.url) ? '' : ownAddress(message.file);
  if (!own && !isWebAddress(message.url)) return false;
  try {
    await browser.tabs.create({ url: own || message.url, index: sender.tab.index + 1, windowId: sender.tab.windowId, openerTabId: sender.tab.id });
    return true;
  } catch (err) {
    return false;
  } finally {
    if (own) setTimeout(() => URL.revokeObjectURL(own), 60000);
  }
}

// C, where the popup can't read the image it shows: the image's file, which the background script can fetch from
// any site. Without cookies and kept out of the cache, which is the normal window's: an image copied in a private
// window would otherwise stay there.
async function imageFile(message) {
  if (!isWebAddress(message.url)) return null;
  try {
    const response = await fetch(message.url, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return null;
    return { type: response.headers.get('content-type') || '', bytes: await response.arrayBuffer() };
  } catch (err) {
    return null;
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'settings') return settingsFor(message, sender);
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

// The button shows "off" on a tab whose site is left alone, with its icon dimmed, and says what a click will do.
// On pages Largitude doesn't work on (about:, file:), it's grayed out.
function showState(tab, excluded) {
  const host = pageHostOf(tab.url);
  const off = !!host && isExcluded(excluded, tab.url);
  const title = !host ? 'Largitude' : off ? `Largitude is off on ${host}: click to turn it on` : `Turn Largitude off on ${host}`;
  const calls = [
    host ? browser.action.enable(tab.id) : browser.action.disable(tab.id),
    browser.action.setBadgeText({ tabId: tab.id, text: off ? 'off' : '' }),
    browser.action.setTitle({ tabId: tab.id, title }),
    browser.action.setIcon({ tabId: tab.id, path: off ? 'icon-off.svg' : 'icon.svg' }),
  ];
  // A tab can close before its state is set.
  return Promise.all(calls).catch(() => {});
}

async function showAllStates() {
  const [{ excluded }, tabs] = await Promise.all([loadOptions(), browser.tabs.query({})]);
  await Promise.all(tabs.map((tab) => showState(tab, excluded)));
}

browser.action.setBadgeBackgroundColor({ color: '#5d6066' });
browser.tabs.onUpdated.addListener(async (tabId, change, tab) => showState(tab, (await loadOptions()).excluded), {
  properties: ['url', 'status'],
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  reading = null;
  showAllStates();
});
browser.runtime.onStartup.addListener(showAllStates);
browser.runtime.onInstalled.addListener(showAllStates);
