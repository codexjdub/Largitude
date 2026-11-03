// Functions with no side effects, used by the content script and the background script and kept apart from
// both so the tests can run them in Node, and addSite, which the site rules in sites/ are added with. They are
// plain function declarations, so every script loaded after this file sees them.

// ---- Sites to leave alone ----

// An entry in the list may be a whole address, such as https://example.com/page pasted from the address bar,
// or *.example.com: only its host name counts.
function hostOf(entry) {
  return String(entry)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/:?#].*$/, '')
    .replace(/^\*\./, '');
}

// The entries of a list of sites, as typed: one per line, or separated by spaces or commas.
function entriesOf(list) {
  return String(list || '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

// Whether the page at `url` is on a site in the list. A site includes its subdomains.
function isExcluded(list, url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (err) {
    return false;
  }
  if (!host) return false;
  return entriesOf(list)
    .map(hostOf)
    .filter(Boolean)
    .some((site) => host === site || host.endsWith('.' + site));
}

// The host name of a web page's address, or '' for other pages (about:, file:, an add-on's own).
function pageHostOf(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : '';
  } catch (err) {
    return '';
  }
}

// The list with the site of the page at `url` added, by its host name without www., so that the rest of the
// site is left alone too. The toolbar button adds the site of the tab it's clicked in.
function listWithSite(list, url) {
  const text = String(list || '');
  const host = pageHostOf(url).replace(/^www\./, '');
  if (!host || isExcluded(text, url)) return text;
  const kept = text.replace(/\s+$/, '');
  return kept ? kept + '\n' + host : host;
}

// The list without the entries that leave the page at `url` alone, one entry per line: the toolbar button,
// clicked again, turns Largitude back on there.
function listWithoutSite(list, url) {
  return entriesOf(list)
    .filter((entry) => !isExcluded(entry, url))
    .join('\n');
}

// ---- Image and video addresses ----

// The candidates in a srcset attribute, as [{ url, w, x }], following the HTML parsing rules closely enough for
// real pages: an address runs to the next whitespace, so commas inside one (Cloudinary's w_400,c_fill, or a
// data: URL) stay in it; commas at its end finish the candidate; otherwise the descriptors run to the next
// comma outside parentheses.
function parseSrcset(srcset) {
  const text = String(srcset || '');
  const candidates = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    let start = i;
    while (i < text.length && !/\s/.test(text[i])) i++;
    let url = text.slice(start, i);
    let descriptors = '';
    if (/,$/.test(url)) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      start = i;
      for (; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth = Math.max(0, depth - 1);
        else if (text[i] === ',' && depth === 0) break;
      }
      descriptors = text.slice(start, i);
    }
    if (!url) continue;
    const candidate = { url };
    descriptors
      .trim()
      .split(/\s+/)
      .forEach((descriptor) => {
        const match = /^(\d+(?:\.\d+)?)([wx])$/i.exec(descriptor);
        if (match) candidate[match[2].toLowerCase()] = Number(match[1]);
      });
    candidates.push(candidate);
  }
  return candidates;
}

// The largest of a srcset's candidates: by width when any has one (w), otherwise by pixel density (x),
// where a candidate with neither counts as 1x.
function largestCandidate(candidates) {
  const withWidth = candidates.filter((c) => c.w > 0);
  const pool = withWidth.length ? withWidth : candidates;
  const size = (c) => (withWidth.length ? c.w : c.x || 1);
  return pool.reduce((best, c) => (!best || size(c) > size(best) ? c : best), null);
}

// Whether an address names an image file, going by its extension, as in a link to photo.jpg.
function isImageFileUrl(url) {
  return hasFileType(url, /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jxl)$/i);
}

// Whether an address names a video file Firefox plays, going by its extension, as in a link to clip.mp4.
function isVideoFileUrl(url) {
  return hasFileType(url, /\.(?:mp4|m4v|webm|ogv)$/i);
}

function hasFileType(url, extension) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && extension.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

// ---- Site rules ----

// What Largitude knows about particular sites: one file each in sites/, loaded after this one, which passes
// addSite an object with
//   name     the site's name
//   larger   [find, replace] pairs for an image's address: when the regular expression `find` matches it, the
//            address with `replace` put in (a string with $1 and the like, or a function, as String.replace
//            takes them) is a larger version of the image
//   gallery  optional, (el, page) → the images of the post `el` is in, when it has several: { images, index },
//            where images[index] is `el`'s <img>; `page` has content.js's closestAcross and closestLink
//   standIn  optional, (url, size) → whether an image that loaded from `url` at `size` ({ width, height }) is
//            the site's stand-in for a file it doesn't have, which the popup skips like a failed load
//   leaveAlone  optional, (url, pageUrl) → whether to leave the image or link at `url` to the site itself on the
//            page at `pageUrl`, as on a site that shows a preview of its own
//   video    optional, (el, page) → for a video the site streams, which can't be played anywhere else, when `el`
//            is its <video> or the poster shown before it plays: { urls, poster }, files of the same video, best
//            first, and its poster image's address
//   original optional, (el) → the address of the original of the <img> `el`, when the page lists it somewhere
//            other than the image's own address, as Google Images does in its scripts; '' when it doesn't
// A var, like the function declarations here, so that it's a global the scripts loaded after this one see.
var SITES = [];

function addSite(site) {
  SITES.push(site);
}

// Larger versions of an image that its address points to, best first, from the site rules. Each is tried before
// the address it was made from, which stays as the fallback.
function fullSizeUrls(url) {
  const urls = [];
  if (typeof url !== 'string') return urls;
  for (const site of SITES) {
    for (const [find, replace] of site.larger || []) {
      if (!find.test(url)) continue;
      const larger = url.replace(find, replace);
      if (larger !== url && urls.indexOf(larger) === -1) urls.push(larger);
    }
  }
  return urls;
}

// Whether a site rule says the image that loaded from `url` at `size` is a stand-in for a missing file.
function isStandIn(url, size) {
  return SITES.some((site) => !!site.standIn && site.standIn(url, size));
}

// Whether a site rule leaves the image or link at `url` to the site, on the page at `pageUrl`.
function isLeftAlone(url, pageUrl) {
  return SITES.some((site) => !!site.leaveAlone && site.leaveAlone(url, pageUrl));
}

// A file name to save the image at `url` under: the last part of its path, with the image's type added when the
// address gives it elsewhere (X's ?format=jpg). Empty when there's nothing to go by, which leaves the name to
// Firefox.
function fileNameFor(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (err) {
    return '';
  }
  let name = parsed.pathname.split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (err) {
    // Not valid percent-encoding: kept as it is.
  }
  // X's older addresses add the size after a colon: photo.jpg:large.
  name = name.replace(/:\w+$/, '');
  if (name && !/\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jxl)$/i.test(name)) {
    const format = /^(jpe?g|png|gif|webp|avif)/i.exec(parsed.searchParams.get('format') || '');
    if (format) name += '.' + format[1].toLowerCase();
  }
  // Characters no file system takes, and dots or spaces at either end, which some hide or drop. Long names keep
  // their end, where the type is.
  return name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(-120);
}

// ---- The page ----

// The opacity of a color as getComputedStyle gives it, from 0 to 1: rgb() and rgba(), and the newer syntaxes the
// browser keeps as written, such as oklch(0.98 0 0 / 0.5) or color(display-p3 1 1 1 / 50%). Anything else, such
// as transparent, counts as see-through.
function colorAlpha(color) {
  const match = /^[a-z-]+\(([^()]*)\)$/i.exec(String(color || '').trim());
  if (!match) return 0;
  const parts = match[1].split(',');
  let alpha = '1';
  if (match[1].indexOf('/') !== -1) alpha = match[1].split('/')[1];
  else if (parts.length === 4) alpha = parts[3];
  alpha = alpha.trim();
  const value = parseFloat(alpha) / (alpha.endsWith('%') ? 100 : 1);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// ---- The popup ----

// Where the popup goes, for an image of `natural` size with the pointer at `pointer` in a window of `view` size.
// The image is fitted, never past its own size, into whichever side of the pointer (right, left, below or
// above) shows it largest, next to the pointer and inside the window. It covers the window instead, pointer
// and all, when every side would show it at less than two thirds of the size the whole window allows, or when
// only the whole window shows it clearly bigger than the page does (`shown`, the size on the page, if any):
// where the pointer happens to be shouldn't decide whether there's a popup. The popup lets the mouse through,
// so the image under it still counts as hovered. `under` is room kept below the popup, for the line of keys
// shown there; above the pointer, it goes between the popup and the pointer. Returns { side, left, top, width,
// height } in CSS pixels, or null when there's no room at all.
function placePopup(natural, pointer, view, shown, under = 0, gap = 16, margin = 8) {
  const fit = (w, h) => (w >= 1 && h >= 1 ? Math.min(1, w / natural.width, h / natural.height) : 0);
  const size = (scale) => ({
    width: Math.max(1, Math.floor(natural.width * scale)),
    height: Math.max(1, Math.floor(natural.height * scale)),
  });
  const sides = [
    { side: 'right', scale: fit(view.width - margin - pointer.x - gap, view.height - 2 * margin - under) },
    { side: 'left', scale: fit(pointer.x - gap - margin, view.height - 2 * margin - under) },
    { side: 'below', scale: fit(view.width - 2 * margin, view.height - margin - pointer.y - gap - under) },
    { side: 'above', scale: fit(view.width - 2 * margin, pointer.y - gap - margin - under) },
  ];
  let best = sides.reduce((a, b) => (b.scale > a.scale ? b : a));
  const whole = fit(view.width - 2 * margin, view.height - 2 * margin - under);
  const cramped = whole > best.scale * 1.5;
  const onlyWholeShowsMore = !isWorthShowing(size(best.scale), shown) && isWorthShowing(size(whole), shown);
  if (cramped || onlyWholeShowsMore) best = { side: 'cover', scale: whole };
  if (!best.scale) return null;
  const { width, height } = size(best.scale);
  const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));
  const across = clamp(pointer.x - width / 2, margin, view.width - margin - width);
  const down = clamp(pointer.y - height / 2, margin, view.height - margin - under - height);
  const spot = {
    right: [pointer.x + gap, down],
    left: [pointer.x - gap - width, down],
    below: [across, pointer.y + gap],
    above: [across, pointer.y - gap - under - height],
    cover: [Math.round((view.width - width) / 2), Math.round((view.height - under - height) / 2)],
  }[best.side];
  return { side: best.side, left: Math.round(spot[0]), top: Math.round(spot[1]), width, height };
}

// Whether the popup shows noticeably more than the page already does: at least 20% wider or taller than the
// image on the page. A cropped thumbnail nearly always passes, since the popup shows the part the page cuts off.
function isWorthShowing(popup, shown) {
  if (!shown || shown.width < 1 || shown.height < 1) return true;
  return popup.width >= shown.width * 1.2 || popup.height >= shown.height * 1.2;
}

// Where the popup goes when R has turned its image `turns` quarter turns: the popup's upright `box`, turned about
// its middle, so the image keeps its size and place. It shrinks only as much as it must to fit the window, and
// moves only as far as it must to stay inside it, with `under` kept free below it, as for placePopup.
function turnInPlace(box, turns, view, under = 0, margin = 8) {
  const across = turns % 2 ? box.height : box.width;
  const down = turns % 2 ? box.width : box.height;
  const scale = Math.min(1, (view.width - 2 * margin) / across, (view.height - 2 * margin - under) / down);
  const width = Math.max(1, Math.floor(across * scale));
  const height = Math.max(1, Math.floor(down * scale));
  const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));
  return {
    left: clamp(box.left + (box.width - width) / 2, margin, view.width - margin - width),
    top: clamp(box.top + (box.height - height) / 2, margin, view.height - margin - under - height),
    width,
    height,
  };
}

// The box an image or video turned `turns` quarter turns about its middle must have to cover `box` once turned:
// the same for a half turn, or with width and height swapped for a quarter turn, on the same middle.
function unturnedBox(box, turns) {
  if (turns % 2 === 0) return box;
  return {
    left: box.left + (box.width - box.height) / 2,
    top: box.top + (box.height - box.width) / 2,
    width: box.height,
    height: box.width,
  };
}

// The CSS transform that shows an image or video turned `turns` quarter turns clockwise and, if `flipped`,
// mirrored left to right: mirrored first, then turned.
function viewTransform(turns, flipped) {
  const steps = [];
  if (turns) steps.push(`rotate(${turns / 4}turn)`);
  if (flipped) steps.push('scaleX(-1)');
  return steps.join(' ') || 'none';
}

// The quarter turns once F has mirrored what's shown left to right on the screen. The image is mirrored before
// it's turned (viewTransform), and mirroring reverses a turn: an image turned a quarter turn clockwise, mirrored,
// is the mirrored image turned a quarter turn the other way.
function turnsOnceFlipped(turns) {
  return (4 - turns) % 4;
}

// Whether `bytes`, the first bytes of a file, are a PNG's: the eight that every PNG starts with.
function isPngData(bytes) {
  return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte);
}

// ---- Settings ----

// How long, in ms, the pointer rests on an image before the popup opens, for the "Wait before showing" setting.
// Anything else, such as a choice from a later version synced from another computer, waits the usual time.
function hoverDelayOf(choice) {
  const delays = { short: 100, normal: 300, long: 700 };
  return Object.hasOwn(delays, choice) ? delays[choice] : delays.normal;
}
