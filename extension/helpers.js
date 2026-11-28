// Functions with no side effects, used by the content script and the background script and kept apart from
// both so the tests can run them in Node, and addSite, which the site rules in sites/ are added with. They are
// plain function declarations, so every script loaded after this file sees them.

// ---- Sites to leave alone ----

// An entry in the list may be a whole address, such as https://example.com/page pasted from the address bar,
// or *.example.com: only its host name counts. One written with letters beyond a to z, as bücher.de, counts in
// the form addresses carry it in, xn--bcher-kva.de.
function hostOf(entry) {
  const host = String(entry)
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/:?#].*$/, '')
    .replace(/^\*\./, '');
  if (!/[^\x00-\x7f]/.test(host)) return host;
  try {
    return new URL('http://' + host).hostname;
  } catch (err) {
    return host;
  }
}

// The list as edited, from `base`, with the changes made to it meanwhile elsewhere, which left it `current`: the
// entries the edit has, but for those taken off elsewhere, then those added elsewhere, one per line.
function rebasedList(base, edited, current) {
  const was = new Set(entriesOf(base));
  const now = new Set(entriesOf(current));
  const kept = entriesOf(edited).filter((entry) => now.has(entry) || !was.has(entry));
  const added = [...now].filter((entry) => !was.has(entry));
  return [...new Set(kept.concat(added))].join('\n');
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
//   fileName optional, (url) → the name to save the file at `url` under, where the end of its address names it
//            poorly, as Reddit's videos, all called after their size; '' to go by the address
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

// A file name to save the image or video at `url` under: the name a site rule gives it, or the last part of its
// path, with the image's type added when the address gives it elsewhere (X's ?format=jpg). Empty when there's
// nothing to go by, which leaves the name to Firefox, and for addresses other than http(s), such as data:, whose
// path is no name at all. A name that still has no type, as Google's photo=s0, gets it from the file once
// background.js asks the server (withExtension).
function fileNameFor(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (err) {
    return '';
  }
  if (!/^https?:$/.test(parsed.protocol)) return '';
  const named = SITES.map((site) => (site.fileName ? site.fileName(url) : '')).find(Boolean);
  let name = named || parsed.pathname.split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch (err) {
    // Not valid percent-encoding: kept as it is.
  }
  // X's older addresses add the size after a colon: photo.jpg:large.
  name = name.replace(/:\w+$/, '');
  if (name && !IMAGE_EXTENSION.test(name)) {
    const format = /^(jpe?g|png|gif|webp|avif)/i.exec(parsed.searchParams.get('format') || '');
    if (format) name += '.' + format[1].toLowerCase();
  }
  // Characters no file system takes, and dots or spaces at either end, which some hide or drop. Firefox refuses a
  // name it would have to change, so spaces of other kinds become plain ones, and invisible characters, such as
  // those that turn the text's direction around, go. Long names keep their end, where the type is.
  return name
    .replace(/\p{Zs}/gu, ' ')
    .replace(/[\p{Cf}\p{Zl}\p{Zp}]/gu, '')
    .replace(/[\\/:*?"<>|\p{Cc}]+/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(-120);
}

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jxl)$/i;
const MEDIA_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jxl|mp4|m4v|webm|ogv)$/i;

// The extension for a file of `type`, a Content-Type, among the images and videos Largitude shows; '' for others.
function extensionForType(type) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/jxl': 'jxl',
    'video/mp4': 'mp4',
    'video/x-m4v': 'm4v',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
  };
  const essence = String(type || '').split(';')[0].trim().toLowerCase();
  return Object.hasOwn(extensions, essence) ? extensions[essence] : '';
}

// Whether a file name ends in an image's or video's extension.
function hasMediaExtension(name) {
  return MEDIA_EXTENSION.test(String(name || ''));
}

// `name` with the extension for a file of `type` added, unless it ends in an image's or video's already, or the
// type isn't one of theirs.
function withExtension(name, type) {
  const extension = extensionForType(type);
  return !name || hasMediaExtension(name) || !extension ? name : name + '.' + extension;
}

// `text` cut to `max` characters at most, from the middle, so that a file name keeps its end and its type.
function shortened(text, max) {
  const chars = Array.from(String(text));
  if (chars.length <= max) return chars.join('');
  const end = Math.floor((max - 1) / 2);
  return chars.slice(0, max - 1 - end).join('') + '…' + chars.slice(chars.length - end).join('');
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

// The transform that makes the popup placed at `box` look as if it were inside `from`, the thumbnail it grows out
// of or shrinks back into: scaled evenly to fit in it, about the popup's own middle, and moved onto its middle.
// '' when either has no size.
function growTransform(from, box) {
  if (!from || !(from.width >= 1 && from.height >= 1 && box.width >= 1 && box.height >= 1)) return '';
  const scale = Math.min(from.width / box.width, from.height / box.height);
  const x = from.left + from.width / 2 - (box.left + box.width / 2);
  const y = from.top + from.height / 2 - (box.top + box.height / 2);
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(4)})`;
}

// The transform that makes the popup R has just turned clockwise, now at `box`, look as it did at `before`:
// turned back a quarter turn, scaled to its size and moved onto its middle, so that it can turn into place.
function turnTransform(before, box) {
  const scale = before.width / box.height;
  const x = before.left + before.width / 2 - (box.left + box.width / 2);
  const y = before.top + before.height / 2 - (box.top + box.height / 2);
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(-0.25turn) scale(${scale.toFixed(4)})`;
}

// How many times bigger an image of `natural` size is than its thumbnail: than the thumbnail's own file where its
// size is known (`thumbSize`), or else than the thumbnail as the page shows it (`shownSize`) in the screen's pixels
// (`pixelRatio` to a CSS pixel). Of width and height, the one that grew less, so that a thumbnail cut down to a
// square doesn't overstate it. 0 when there's nothing to compare with.
function sizeFactor(natural, thumbSize, shownSize, pixelRatio = 1) {
  const sized = (size) => !!size && size.width > 0 && size.height > 0;
  const base = sized(thumbSize)
    ? thumbSize
    : sized(shownSize)
      ? { width: shownSize.width * pixelRatio, height: shownSize.height * pixelRatio }
      : null;
  return base ? Math.min(natural.width / base.width, natural.height / base.height) : 0;
}

// An image's size, and how many times bigger than its thumbnail when that's worth saying: "1600 × 1200 · 4×
// larger".
function sizeLabel(natural, factor) {
  const size = `${natural.width} × ${natural.height}`;
  if (!(factor >= 1.2)) return size;
  const times = factor < 10 ? Math.round(factor * 10) / 10 : Math.round(factor);
  return `${size} · ${times}× larger`;
}

// A file's size as people read it: "640 bytes", "820 KB", "2.4 MB". '' for none.
function formatBytes(bytes) {
  if (!(bytes > 0)) return '';
  if (bytes < 1000) return Math.round(bytes) + ' bytes';
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  const shown = () => (value < 9.95 ? Math.round(value * 10) / 10 : Math.round(value));
  while (shown() >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${shown()} ${units[unit]}`;
}

// A time in seconds as a clock shows it: "0:07", "12:34", "1:02:03".
function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// What kind of file is at `url`, as people know it, "JPEG", "PNG", "MP4": from a data: address's type, or from the
// file's name. '' when the address doesn't say.
function kindOfFile(url) {
  const data = /^data:([^;,]+)/i.exec(url);
  const name = data ? 'file.' + extensionForType(data[1].trim().toLowerCase()) : fileNameFor(url);
  if (!MEDIA_EXTENSION.test(name)) return '';
  const extension = name.split('.').pop().toLowerCase();
  return { jpg: 'JPEG', jpeg: 'JPEG', ogv: 'Ogg' }[extension] || extension.toUpperCase();
}

// Where a video goes `step` seconds on from `time` (back, for a negative step): no further back than its start,
// and not past its end, for one whose `length` is known, which would only start it again.
function seekTime(time, step, length) {
  const to = Math.max(0, time + step);
  return length > 0 && length < Infinity ? Math.min(to, Math.max(0, length - 0.25)) : to;
}

// Whether two images are shown at sizes alike enough to be the same kind of image, such as two photos in a feed
// rather than a photo and a profile picture: neither width nor height more than `ratio` times the other's.
function similarSize(a, b, ratio = 2) {
  const sized = (size) => !!size && size.width > 0 && size.height > 0;
  if (!sized(a) || !sized(b)) return false;
  const near = (x, y) => Math.max(x, y) <= Math.min(x, y) * ratio;
  return near(a.width, b.width) && near(a.height, b.height);
}

// A tall image, such as a long screenshot or a comic, fitted whole into the window comes out too narrow to read.
// Placed instead as if it were as wide as it is and half as tall again, it opens wide enough, and the rest is
// seen by moving down (panOffset). Null for an image that shows well enough whole: not twice as tall as it is
// wide, or shown at half its width or more anyway in `whole`, the popup placed for the whole image.
function readableSize(natural, whole) {
  if (!natural || !(natural.width >= 1) || natural.height < natural.width * 2) return null;
  if (whole && whole.width >= natural.width * 0.5) return null;
  return { width: natural.width, height: Math.round(natural.width * 1.5) };
}

// How far up to move a tall image shown `width` wide in a popup `boxHeight` tall, in px (0 or less), for the
// pointer at `y` over the thumbnail `rect`: the image's top shows with the pointer in the thumbnail's top tenth,
// its bottom in the bottom tenth, and in between the part as far down as the pointer is.
function panOffset(natural, width, boxHeight, y, rect) {
  const room = Math.max(0, (natural.height * width) / natural.width - boxHeight);
  if (!room || !rect || !(rect.height > 0)) return 0;
  const edge = rect.height * 0.1;
  const share = Math.min(1, Math.max(0, (y - rect.top - edge) / (rect.height - 2 * edge)));
  return -Math.round(room * share) || 0;
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
