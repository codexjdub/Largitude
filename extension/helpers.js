// Functions with no side effects, used by the content script and the background script and kept apart from
// both so the tests can run them in Node. They are plain function declarations, so every script loaded after
// this file sees them.

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

// Whether the page at `url` is on a site in the list (one per line, or separated by spaces or commas).
// A site includes its subdomains.
function isExcluded(list, url) {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch (err) {
    return false;
  }
  if (!host) return false;
  return String(list || '')
    .split(/[\s,]+/)
    .map(hostOf)
    .filter(Boolean)
    .some((site) => host === site || host.endsWith('.' + site));
}

// ---- Image addresses ----

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
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && /\.(?:jpe?g|png|gif|webp|avif|bmp|svg|jxl)$/i.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

// ---- Site rules ----

// Larger versions of an image that its address points to, best first, from what is known of the site that
// serves it. Each is tried before the address it was made from, which stays as the fallback.
function fullSizeUrls(url) {
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch (err) {
    return [];
  }
  const { hostname, pathname, origin } = parsed;
  // Reddit shows copies at most 1080 px wide (preview.redd.it); the original upload is on i.redd.it, under the
  // copy's id. Newer copies put words from the post's title before the id: some-title-v0-<id>.png.
  if (hostname === 'preview.redd.it') {
    const match = /^\/(?:.*-v\d+-)?([a-z0-9]+)\.(jpe?g|png|gif|webp)$/i.exec(pathname);
    return match ? ['https://i.redd.it/' + match[1] + '.' + match[2]] : [];
  }
  if (hostname === 'pbs.twimg.com') {
    // X's photos and video stills: name= picks the size (small, medium, large, orig, …). Older addresses carry
    // the format in the path instead: <id>.jpg, or <id>.jpg:large.
    if (/^\/(?:media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\//.test(pathname)) {
      const old = /^(.+?)\.(jpe?g|png|webp)(?::\w+)?$/i.exec(pathname);
      if (old) return [origin + old[1] + '?format=' + old[2].toLowerCase() + '&name=orig'];
      parsed.searchParams.set('name', 'orig');
      return parsed.href === url ? [] : [parsed.href];
    }
    // Profile pictures are cut down from the original, named with _normal, _bigger, _400x400 and the like.
    const avatar = /^(\/profile_images\/.+?)_(?:normal|bigger|mini|reasonably_small|\d+x\d+)(\.\w+)$/.exec(pathname);
    if (avatar) return [origin + avatar[1] + avatar[2]];
    // Profile banners: the last part of the path is the size; 1500x500 is the largest.
    const banner = /^(\/profile_banners\/\d+\/\d+)\/\d+x\d+$/.exec(pathname);
    if (banner && !pathname.endsWith('/1500x500')) return [origin + banner[1] + '/1500x500'];
  }
  return [];
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

// ---- The popup ----

// Where the popup goes, for an image of `natural` size with the pointer at `pointer` in a window of `view` size.
// The image is fitted, never past its own size, into whichever side of the pointer (right, left, below or
// above) shows it largest, next to the pointer and inside the window. It covers the window instead, pointer
// and all, when every side would show it at less than two thirds of the size the whole window allows, or when
// only the whole window shows it clearly bigger than the page does (`shown`, the size on the page, if any):
// where the pointer happens to be shouldn't decide whether there's a popup. The popup lets the mouse through,
// so the image under it still counts as hovered. Returns { side, left, top, width, height } in CSS pixels, or
// null when there's no room at all.
function placePopup(natural, pointer, view, shown, gap = 16, margin = 8) {
  const fit = (w, h) => (w >= 1 && h >= 1 ? Math.min(1, w / natural.width, h / natural.height) : 0);
  const size = (scale) => ({
    width: Math.max(1, Math.floor(natural.width * scale)),
    height: Math.max(1, Math.floor(natural.height * scale)),
  });
  const sides = [
    { side: 'right', scale: fit(view.width - margin - pointer.x - gap, view.height - 2 * margin) },
    { side: 'left', scale: fit(pointer.x - gap - margin, view.height - 2 * margin) },
    { side: 'below', scale: fit(view.width - 2 * margin, view.height - margin - pointer.y - gap) },
    { side: 'above', scale: fit(view.width - 2 * margin, pointer.y - gap - margin) },
  ];
  let best = sides.reduce((a, b) => (b.scale > a.scale ? b : a));
  const whole = fit(view.width - 2 * margin, view.height - 2 * margin);
  const cramped = whole > best.scale * 1.5;
  const onlyWholeShowsMore = !isWorthShowing(size(best.scale), shown) && isWorthShowing(size(whole), shown);
  if (cramped || onlyWholeShowsMore) best = { side: 'cover', scale: whole };
  if (!best.scale) return null;
  const { width, height } = size(best.scale);
  const clamp = (value, low, high) => Math.round(Math.max(low, Math.min(value, high)));
  const across = clamp(pointer.x - width / 2, margin, view.width - margin - width);
  const down = clamp(pointer.y - height / 2, margin, view.height - margin - height);
  const spot = {
    right: [pointer.x + gap, down],
    left: [pointer.x - gap - width, down],
    below: [across, pointer.y + gap],
    above: [across, pointer.y - gap - height],
    cover: [Math.round((view.width - width) / 2), Math.round((view.height - height) / 2)],
  }[best.side];
  return { side: best.side, left: Math.round(spot[0]), top: Math.round(spot[1]), width, height };
}

// Whether the popup shows noticeably more than the page already does: at least 20% wider or taller than the
// image on the page. A cropped thumbnail nearly always passes, since the popup shows the part the page cuts off.
function isWorthShowing(popup, shown) {
  if (!shown || shown.width < 1 || shown.height < 1) return true;
  return popup.width >= shown.width * 1.2 || popup.height >= shown.height * 1.2;
}
