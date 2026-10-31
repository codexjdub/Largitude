// Largitude's background script: gives each frame the settings that apply to it, and saves the image the popup
// shows when the user presses S. Later it will also fetch the pages and JSON some site rules need, such as a
// Reddit post's, which a content script can only read from its own page's site.
//
// DEFAULT_OPTIONS comes from defaults.js and isExcluded from helpers.js, both loaded first.

async function settingsFor(sender) {
  const { options } = await browser.storage.local.get('options');
  const { excluded, reverseWheel } = { ...DEFAULT_OPTIONS, ...options };
  return {
    // The tab's page counts as well as the frame's own address, so a frame embedded on a site to leave alone is
    // left alone too.
    excluded: [sender.tab && sender.tab.url, sender.url].some((url) => !!url && isExcluded(excluded, url)),
    reverseWheel: !!reverseWheel,
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

browser.runtime.onMessage.addListener((message, sender) => {
  if (message && message.type === 'settings') return settingsFor(sender);
  if (message && message.type === 'save') return save(message, sender);
  return undefined;
});
