// Google Images: a result's original, which Google's page lists in its scripts. Each result shows a copy a few
// hundred pixels across, from encrypted-tbn0.gstatic.com or inline (a data: address); the page's scripts list the
// first 100 or so results as "<result id>",[copy, height, width],[original, height, width]. Results loaded while
// scrolling are listed only inside Google's own scripts, out of reach, so their copy shows, as on any page.
(() => {
  const SEARCH = /^https:\/\/www\.google\.[a-z.]+\/search\b/;
  const LISTED = /"([\w-]{8,24})",\["https?:[^"]+",\d+,\d+\],\["(https?:[^"]+)",\d+,\d+\]/g;

  // The originals by result id, from the page's scripts. The same page comes up on every move of the mouse, so
  // they're read again only when there are more scripts.
  let read = { doc: null, count: -1, originals: new Map() };
  function originalsIn(doc) {
    const scripts = doc.scripts;
    if (read.doc === doc && read.count === scripts.length) return read.originals;
    const originals = new Map();
    for (let i = 0; i < scripts.length; i++) {
      for (const [, id, address] of scripts[i].textContent.matchAll(LISTED)) {
        try {
          // JSON in the script: & and = come as & and =.
          originals.set(id, JSON.parse('"' + address + '"'));
        } catch (err) {
          // Not an address after all.
        }
      }
    }
    read = { doc, count: scripts.length, originals };
    return originals;
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
