// Google Images: a result's original, which Google's page lists in its scripts. Each result shows a copy a few
// hundred pixels across, from encrypted-tbn0.gstatic.com or inline (a data: address); the page's scripts list the
// first 100 or so results as "<result id>",[copy, height, width],[original, height, width]. Results loaded while
// scrolling are listed only inside Google's own scripts, out of reach, so their copy shows, as on any page.
(() => {
  const SEARCH = /^https:\/\/www\.google\.[a-z.]+\/search\b/;
  const LISTED = /"([\w-]{8,24})",\["https?:[^"]+",\d+,\d+\],\["(https?:[^"]+)",\d+,\d+\]/g;

  // The originals by result id, from the page's scripts. The same page comes up on every move of the mouse, and
  // its scripts run to megabytes, so they're looked at again only when there are more, and then only those not read
  // yet. One with no text yet, or a file's, is looked at again next time.
  let read = { doc: null, count: -1, done: new WeakSet(), originals: new Map() };
  function originalsIn(doc) {
    const scripts = doc.scripts;
    if (read.doc !== doc) read = { doc, count: -1, done: new WeakSet(), originals: new Map() };
    if (read.count === scripts.length) return read.originals;
    for (let i = 0; i < scripts.length; i++) {
      const script = scripts[i];
      if (read.done.has(script)) continue;
      const text = script.textContent;
      if (text) read.done.add(script);
      for (const [, id, address] of text.matchAll(LISTED)) {
        try {
          // JSON in the script: & and = come as & and =.
          read.originals.set(id, JSON.parse('"' + address + '"'));
        } catch (err) {
          // Not an address after all.
        }
      }
    }
    read.count = scripts.length;
    return read.originals;
  }

  addSite({
    name: 'Google Images',
    // A result is the element around its image with a data-docid, the id the scripts list it under.
    original(el) {
      const doc = el.ownerDocument;
      if (!doc || !SEARCH.test(doc.location.href)) return '';
      const result = el.closest('[data-docid]');
      return (result && originalsIn(doc).get(result.getAttribute('data-docid'))) || '';
    },
  });
})();
