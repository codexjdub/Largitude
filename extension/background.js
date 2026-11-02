// Largitude's background script: gives each frame the settings that apply to it, saves the image the popup
// shows when the user presses S or opens it in a tab for O, and runs the toolbar button. Later it will also fetch the pages and JSON some
// site rules need, such as a Reddit post's, which a content script can only read from its own page's site.
//
// DEFAULT_OPTIONS comes from defaults.js; isExcluded, pageHostOf, listWithSite and listWithoutSite from
// helpers.js, both loaded first.

async function loadOptions() {
  const { options } = await browser.storage.local.get('options');
  return { ...DEFAULT_OPTIONS, ...options };
}

async function settingsFor(sender) {
  const { excluded, galleryWheelReversed } = await loadOptions();
  return {
    // The tab's page counts as well as the frame's own address, so a frame embedded on a site to leave alone is
    // left alone too.
    excluded: [sender.tab && sender.tab.url, sender.url].some((url) => !!url && isExcluded(excluded, url)),
    reverseWheel: !!galleryWheelReversed,
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

browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'settings') return settingsFor(sender);
  if (message && message.type === 'save') return save(message, sender);
  if (message && message.type === 'open') return openTab(message, sender);
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
  await browser.storage.local.set({ options: { ...options, excluded } });
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

async function showAllStates() {
  const [{ excluded }, tabs] = await Promise.all([loadOptions(), browser.tabs.query({})]);
  await Promise.all(tabs.map((tab) => showState(tab, excluded)));
}

browser.action.setBadgeBackgroundColor({ color: '#5d6066' });
browser.tabs.onUpdated.addListener(
  async (tabId, change, tab) => showState(tab, (await loadOptions()).excluded),
  { properties: ['url', 'status'] }
);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.options) showAllStates();
});
browser.runtime.onStartup.addListener(showAllStates);
browser.runtime.onInstalled.addListener(showAllStates);
