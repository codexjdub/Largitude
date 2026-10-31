// Largitude in each frame: finds the image or video under the pointer and, once the pointer has rested on it,
// shows it full size in a popup beside the pointer, videos muted and looping. When the image is one of a post's
// several (a Reddit gallery, the photos of an X post), ← → and the mouse wheel move through them; S saves what
// the popup shows, and for a video M turns the sound on or off and Space pauses. It runs in the content-script
// world, out of the page's reach. The popup sits in the page's top layer, above everything the page shows, and
// lets the mouse through.
// parseSrcset, fullSizeUrls, fileNameFor, placePopup and the other helpers come from helpers.js, and SITES from
// the site rules in sites/, all loaded first.
(() => {
  'use strict';

  const root = document.documentElement;
  // Web pages only: SVG and XML documents have no popovers to show the popup in.
  if (!root || typeof root.showPopover !== 'function') return;

  const DELAY = 300; // ms the pointer rests on an image before the popup opens
  const SPINNER_AFTER = 150; // ms an image may take to start arriving before a spinner shows
  const MIN_SIZE = 24; // px: smaller images, such as icons and emoji, are left alone
  const MAX_LAYERS = 8; // elements under the pointer looked through for an image
  const WHEEL_STEP = 40; // px of wheel movement that moves to the next image in a gallery
  const WHEEL_SETTLE = 150; // ms without wheel movement that ends a gesture, which moves one image at most
  const SHOWABLE_TYPES = /^image\/(?:jpeg|png|gif|webp|avif|bmp|svg\+xml)$/i;
  // Wheel events say which way the page would scroll, not which way the fingers moved. macOS reverses the two
  // with natural scrolling, its default, which pages can't detect; elsewhere they agree.
  const NATURAL_SCROLLING = /^Mac/.test(navigator.platform);

  let enabled = false;
  let reverseWheel = false; // the "Reverse the mouse wheel in galleries" setting
  let pointer = { x: 0, y: 0 };
  let frame = 0; // the animation frame that will look under the pointer
  let hovered = null; // the image or video under the pointer: { el, thumb, thumbSize, urls, shownSize }
  let dismissed = null; // an element whose popup was closed (click, Escape, nothing to show), until the pointer leaves it
  let timer = 0;
  let spinnerTimer = 0;
  let sizeFrame = 0;
  let loading = null; // the <img> or <video> being loaded, shown once its size is known
  let shown = false;
  let gallery = null; // while the popup shows one of several images: { items: [{ thumb, thumbSize, urls }], index }
  let preloaded = []; // the gallery's images on either side of the one shown, loading in advance

  // ---- Finding the image under the pointer ----

  // Everything under the point, topmost first, including inside shadow roots: closed ones too, which Firefox
  // lets extensions see.
  function layersAt(x, y) {
    const layers = [];
    const visit = (scope, depth) => {
      let found = [];
      try {
        found = scope.elementsFromPoint(x, y);
      } catch (err) {
        return;
      }
      for (let i = 0; i < found.length; i++) {
        const el = found[i];
        if (el === host || layers.indexOf(el) !== -1) continue;
        const shadow = depth < 4 && (el.openOrClosedShadowRoot || el.shadowRoot);
        if (shadow && shadow !== scope) visit(shadow, depth + 1);
        if (layers.indexOf(el) === -1) layers.push(el);
      }
    };
    visit(document, 0);
    return layers;
  }

  function findImage(x, y) {
    const layers = layersAt(x, y).slice(0, MAX_LAYERS);
    const searched = [];
    for (const el of layers) {
      if (el === document.body || el === root) break;
      searched.push(el);
      const found = imageOf(el);
      if (found) return found;
      // Text under the pointer is what's being hovered, and an element with a background color of its own
      // hides what's under it, as does a video, so the search stops at any of them. Transparent overlays are
      // looked through.
      if (hasOwnText(el) || isOpaque(el) || el.localName === 'video') break;
    }
    // An image that ignores the mouse (pointer-events: none) isn't among the layers: look inside the small ones.
    for (const el of searched) {
      const found = imageInside(el, x, y);
      if (found) return found;
    }
    // A link to an image or video file, with no image of its own to show.
    const link = layers.length ? closestLink(layers[0]) : null;
    if (link && isMediaLink(link.href)) {
      return { el: link, thumb: '', thumbSize: null, urls: withRules([link.href]), shownSize: null };
    }
    return null;
  }

  // The image an element shows, as an <img>, a <video> or a CSS background, with the addresses to try for its
  // full size.
  function imageOf(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width < MIN_SIZE || rect.height < MIN_SIZE) return null;
    let found = null;
    if (el.localName === 'video') {
      found = videoSourcesOf(el);
      if (!found) return null;
    } else {
      if (el.localName === 'img') {
        found = sourcesOf(el);
      } else {
        const background = backgroundOf(el);
        found = { thumb: background, thumbSize: null, urls: withRules([linkedMedia(el), background]) };
      }
      if (!/^(?:https?|data|blob):/i.test(found.thumb)) return null;
    }
    return { ...found, el, shownSize: { width: rect.width, height: rect.height } };
  }

  // The addresses to try for an <img>'s full size, best first: a link around it to an image file, the largest
  // in its srcset, then what it shows. Lazy-loading pages keep the last two in data-lazy-src and
  // data-lazy-srcset until the image comes into view.
  function sourcesOf(img) {
    const lazy = img.getAttribute('data-lazy-src');
    const thumb = img.currentSrc || img.src || (lazy ? absolute(lazy, img) : '');
    const largest = largestCandidate(srcsetOf(img));
    return {
      thumb,
      thumbSize: img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null,
      urls: withRules([linkedMedia(img), largest ? largest.url : '', thumb]),
    };
  }

  // A video the page plays from a file, which the popup plays again, bigger, with the page's poster standing in
  // until it starts. A streaming player's video has a blob: address, put together piece by piece, which can't be
  // played anywhere else, so it's left alone.
  function videoSourcesOf(video) {
    const source = video.querySelector('source[src]');
    const src = video.currentSrc || video.src || (source ? source.src : '');
    if (!/^https?:/i.test(src)) return null;
    return {
      thumb: video.poster || '',
      thumbSize: video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : null,
      urls: withRules([src]),
    };
  }

  // Each address preceded by any larger version the site rules know of, without repeats.
  function withRules(addresses) {
    const urls = [];
    addresses.forEach((address) => {
      if (!address) return;
      fullSizeUrls(address)
        .concat(address)
        .forEach((url) => {
          if (urls.indexOf(url) === -1) urls.push(url);
        });
    });
    return urls;
  }

  // An <img>'s srcset candidates, with those of the <source> elements around it in a <picture>, as full addresses.
  function srcsetOf(img) {
    const sets = [img.getAttribute('srcset'), img.getAttribute('data-lazy-srcset')];
    const picture = img.parentElement;
    if (picture && picture.localName === 'picture') {
      const children = picture.children;
      for (let i = 0; i < children.length; i++) {
        const source = children[i];
        if (source.localName !== 'source') continue;
        if (source.type && !SHOWABLE_TYPES.test(source.type)) continue;
        sets.push(source.getAttribute('srcset'));
      }
    }
    const candidates = [];
    sets.forEach((set) => {
      parseSrcset(set).forEach((candidate) => {
        const url = absolute(candidate.url, img);
        if (url) candidates.push({ ...candidate, url });
      });
    });
    return candidates;
  }

  function absolute(url, el) {
    try {
      return new URL(url, el.baseURI).href;
    } catch (err) {
      return '';
    }
  }

  function backgroundOf(el) {
    const match = /url\(\s*(["']?)(.*?)\1\s*\)/.exec(getComputedStyle(el).backgroundImage || '');
    return match ? match[2] : '';
  }

  function hasOwnText(el) {
    const nodes = el.childNodes;
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === Node.TEXT_NODE && nodes[i].data.trim()) return true;
    }
    return false;
  }

  function isOpaque(el) {
    const match = /rgba?\(([^)]*)\)/.exec(getComputedStyle(el).backgroundColor || '');
    if (!match) return false;
    const channels = match[1].split(/[\s,/]+/).filter(Boolean);
    return channels.length < 4 || parseFloat(channels[3]) > 0.5;
  }

  function imageInside(el, x, y) {
    const rect = el.getBoundingClientRect();
    const view = viewport();
    if (rect.width > view.width / 2 || rect.height > view.height / 2) return null;
    const images = el.querySelectorAll('img, video');
    for (let i = 0; i < images.length && i < 20; i++) {
      const box = images[i].getBoundingClientRect();
      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
      const found = imageOf(images[i]);
      if (found) return found;
    }
    return null;
  }

  // Whether `el` is inside `container`, looking out through any shadow roots it's in.
  function containsAcross(container, el) {
    for (let node = el; node; ) {
      if (container.contains(node)) return true;
      const scope = node.getRootNode();
      node = scope && scope !== document && scope.host ? scope.host : null;
    }
    return false;
  }

  // The nearest element around `el` matching `selector`, looking out through any shadow roots it's in.
  function closestAcross(el, selector) {
    for (let node = el; node; ) {
      const match = node.closest(selector);
      if (match) return match;
      const scope = node.getRootNode();
      node = scope && scope !== document && scope.host ? scope.host : null;
    }
    return null;
  }

  function closestLink(el) {
    const link = closestAcross(el, 'a[href]');
    return link && typeof link.href === 'string' ? link : null;
  }

  // The address of a link around `el` to an image or video file, if there is one.
  function linkedMedia(el) {
    const link = closestLink(el);
    return link && isMediaLink(link.href) ? link.href : '';
  }

  // Whether a link leads to an image or video file, or to one the site rules know, such as Imgur's GIFV pages.
  function isMediaLink(url) {
    return isImageFileUrl(url) || isVideoFileUrl(url) || fullSizeUrls(url).length > 0;
  }

  function viewport() {
    const box = document.compatMode === 'BackCompat' && document.body ? document.body : root;
    return { width: box.clientWidth || innerWidth, height: box.clientHeight || innerHeight };
  }

  // ---- Galleries ----

  // What the site rules' gallery functions may use to look around the page.
  const page = { closestAcross, closestLink };

  // The images of the post `el` is in, when it has several: { items, index }, where items[index] is `el`'s. The
  // site rules know which elements make up a post.
  function galleryOf(el) {
    for (const site of SITES) {
      const found = site.gallery ? site.gallery(el, page) : null;
      if (found) return { items: found.images.map((img) => sourcesOf(img)), index: found.index };
    }
    return null;
  }

  // ---- The popup ----

  let host = null;
  let thumbImg = null;
  let full = null; // the full-size <img> or <video> in the popup
  let spinner = null;
  let counter = null;
  let progress = null;
  let progressFrame = 0;
  let toast = null;
  let toastTimer = 0;

  const make = (tag) => document.createElement(tag);
  const setStyles = (el, styles, important) =>
    Object.keys(styles).forEach((name) => el.style.setProperty(name, styles[name], important ? 'important' : ''));
  const FILL = { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', margin: '0' };

  // Styles are set on the elements themselves rather than in a stylesheet: a page's content security policy
  // can't block them, and !important on the host beats the page's stylesheets and the browser's popover styles.
  function createHost() {
    host = make('largitude-popup');
    host.setAttribute('popover', 'manual');
    setStyles(
      host,
      {
        all: 'initial',
        display: 'none',
        position: 'fixed',
        inset: 'auto',
        margin: '0',
        padding: '0',
        border: '0',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        'pointer-events': 'none',
        'border-radius': '4px',
        background: '#1c1c1e',
        'box-shadow': '0 0 0 1px rgba(0, 0, 0, 0.25), 0 12px 40px rgba(0, 0, 0, 0.45)',
      },
      true
    );
    const shadow = host.attachShadow({ mode: 'open' });
    thumbImg = make('img');
    thumbImg.alt = '';
    setStyles(thumbImg, FILL);
    // A ring on a dark disc, so it shows on light images too.
    spinner = make('div');
    setStyles(spinner, {
      position: 'absolute',
      'z-index': '1',
      width: '14px',
      height: '14px',
      border: '2px solid rgba(255, 255, 255, 0.3)',
      'border-top-color': '#fff',
      'border-radius': '50%',
      background: 'rgba(0, 0, 0, 0.45)',
      'box-shadow': '0 0 0 6px rgba(0, 0, 0, 0.45)',
    });
    try {
      spinner.animate([{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 800, iterations: Infinity });
    } catch (err) {
      // A still ring then.
    }
    // Where in a gallery the image is: "2 / 5".
    counter = make('div');
    setStyles(counter, {
      position: 'absolute',
      'z-index': '1',
      top: '8px',
      right: '8px',
      padding: '2px 8px',
      'border-radius': '10px',
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#fff',
      font: '600 12px/18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      'font-variant-numeric': 'tabular-nums',
      display: 'none',
    });
    // How far a video has played: a thin bar along the bottom.
    progress = make('div');
    setStyles(progress, {
      position: 'absolute',
      'z-index': '1',
      left: '0',
      bottom: '0',
      width: '0',
      height: '3px',
      background: 'rgba(255, 255, 255, 0.75)',
      display: 'none',
    });
    // A short note at the bottom, such as "Saved".
    toast = make('div');
    setStyles(toast, {
      position: 'absolute',
      'z-index': '1',
      left: '50%',
      bottom: '10px',
      transform: 'translateX(-50%)',
      padding: '4px 12px',
      'border-radius': '12px',
      background: 'rgba(0, 0, 0, 0.7)',
      color: '#fff',
      font: '600 13px/18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      'white-space': 'nowrap',
      display: 'none',
    });
    shadow.append(thumbImg, spinner, counter, progress, toast);
  }

  function note(text) {
    if (!shown) return;
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 1500);
  }

  function placeHost(box) {
    if (!host) createHost();
    if (!host.isConnected) root.append(host);
    setStyles(
      host,
      { display: 'block', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' },
      true
    );
    // Shown afresh each time, it goes above whatever the page has put in the top layer since.
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch (err) {
      // Removed by the page in the meantime: it goes back in next time.
    }
  }

  // The spinner, on its own beside the pointer while the first image's size isn't known yet, or in the corner
  // of the popup while the next image of a gallery is on its way.
  function showSpinner(alone) {
    spinnerTimer = 0;
    if (!host) createHost();
    const inset = alone ? '6px' : '12px';
    setStyles(spinner, { display: 'block', left: inset, top: inset });
    if (!alone) return;
    const view = viewport();
    const size = 30;
    thumbImg.style.display = 'none';
    if (full) full.style.display = 'none';
    placeHost({
      left: Math.max(0, Math.min(pointer.x + 16, view.width - size - 8)),
      top: Math.max(0, Math.min(pointer.y + 16, view.height - size - 8)),
      width: size,
      height: size,
    });
  }

  // Shows `media`, an image or video whose size is known, for `item` (the hovered image or video, or one of its
  // gallery's).
  function showMedia(item, media, box) {
    clearTimeout(spinnerTimer);
    spinnerTimer = 0;
    if (!host) createHost();
    spinner.style.display = 'none';
    // The thumbnail, already loaded, stands in while the full image arrives over it, or until the video's first
    // frame, if it's the same shape.
    if (item.thumb && item.thumb !== media.src && item.thumbSize && sameShape(item.thumbSize, sizeOf(media))) {
      thumbImg.src = item.thumb;
      thumbImg.style.display = 'block';
    } else {
      thumbImg.removeAttribute('src');
      thumbImg.style.display = 'none';
    }
    if (full !== media) {
      if (full) {
        full.remove();
        release(full);
      }
      full = media;
      setStyles(media, FILL);
      host.shadowRoot.insertBefore(media, spinner);
    }
    media.style.display = 'block';
    if (gallery) counter.textContent = gallery.index + 1 + ' / ' + gallery.items.length;
    counter.style.display = gallery ? 'block' : 'none';
    placeHost(box);
    shown = true;
    listenToWheel(!!gallery);
    if (isVideo(media)) play(media, item.el);
  }

  const isVideo = (media) => !!media && media.localName === 'video';
  const sizeOf = (media) =>
    isVideo(media) ? { width: media.videoWidth, height: media.videoHeight } : { width: media.naturalWidth, height: media.naturalHeight };
  const sameShape = (a, b) => Math.abs(a.width / a.height - b.width / b.height) <= 0.03 * (b.width / b.height);

  // Starts the popup's video, from where the page's own is when it's that video, and the bar showing its progress.
  function play(video, pageVideo) {
    if (isVideo(pageVideo) && pageVideo.currentTime > 0 && (pageVideo.currentSrc || pageVideo.src) === video.src) {
      video.currentTime = pageVideo.currentTime;
    }
    resume(video, 'Autoplay is off on this site: Space plays');
    cancelAnimationFrame(progressFrame);
    trackProgress();
  }

  // Plays `video`, with a note if Firefox doesn't allow it: muted videos play on their own unless autoplay is
  // turned off altogether.
  function resume(video, blocked) {
    const playing = video.play();
    if (playing && playing.catch) {
      playing.catch((err) => {
        if (err && err.name === 'NotAllowedError' && full === video) note(blocked);
      });
    }
  }

  function trackProgress() {
    progressFrame = 0;
    if (!shown || !isVideo(full)) {
      progress.style.display = 'none';
      return;
    }
    // A video still loading, or one that never says how long it is, has no progress to show.
    const length = full.duration;
    const done = length > 0 && length < Infinity ? full.currentTime / length : 0;
    progress.style.width = Math.min(100, done * 100) + '%';
    progress.style.display = done > 0 ? 'block' : 'none';
    progressFrame = requestAnimationFrame(trackProgress);
  }

  // Stops `media` loading: dropping its address stops an image's download, and a video's once it's told to load
  // anew, with nothing.
  function release(media) {
    media.removeAttribute('src');
    if (isVideo(media)) {
      media.pause();
      media.load();
    }
  }

  function hide() {
    clearTimeout(timer);
    clearTimeout(spinnerTimer);
    cancelAnimationFrame(sizeFrame);
    cancelAnimationFrame(progressFrame);
    timer = spinnerTimer = sizeFrame = progressFrame = 0;
    // Releasing stops the download; the handlers below ignore an image or video that's no longer `loading`.
    const old = loading;
    loading = null;
    if (old && old !== full) release(old);
    preloaded.forEach(release);
    preloaded = [];
    hovered = null;
    gallery = null;
    shown = false;
    listenToWheel(false);
    if (!host) return;
    host.style.setProperty('display', 'none', 'important');
    try {
      host.hidePopover();
    } catch (err) {
      // Already hidden.
    }
    if (full) {
      full.remove();
      release(full);
      full = null;
    }
    thumbImg.removeAttribute('src');
    counter.style.display = 'none';
    progress.style.display = 'none';
    clearTimeout(toastTimer);
    toast.style.display = 'none';
  }

  function dismiss() {
    if (hovered) dismissed = hovered.el;
    hide();
  }

  // ---- Loading ----

  // Loads the first of `urls` that works, as an <img>, or a <video> for a video file, and calls `done` with it as
  // soon as its size is known, long before it has finished loading, so the popup opens at its final size and the
  // image fills in. `done` gets null when none works. Starting another load cancels this one.
  function fetchMedia(urls, done, index = 0) {
    if (loading && loading !== full) release(loading);
    loading = null;
    if (index >= urls.length) {
      done(null);
      return;
    }
    const video = isVideoFileUrl(urls[index]);
    const media = video ? makeVideo() : make('img');
    loading = media;
    let sized = false;
    const ready = () => {
      if (sized || loading !== media) return;
      const size = sizeOf(media);
      if (!(size.width > 0 && size.height > 0)) return;
      sized = true;
      done(media);
    };
    const next = () => {
      if (loading !== media) return;
      if (sized) dismiss();
      else fetchMedia(urls, done, index + 1);
    };
    media.addEventListener('error', next);
    cancelAnimationFrame(sizeFrame);
    if (video) {
      // A video's size comes with its metadata; one without a picture is sound only.
      media.addEventListener('loadedmetadata', () => (sizeOf(media).width > 0 ? ready() : next()));
      media.src = urls[index];
      return;
    }
    media.alt = '';
    media.addEventListener('load', ready);
    media.src = urls[index];
    const poll = () => {
      sizeFrame = 0;
      ready();
      if (!sized && loading === media && !media.complete) sizeFrame = requestAnimationFrame(poll);
    };
    poll();
  }

  // Muted, so it may play on its own, and looping, as a GIF does.
  function makeVideo() {
    const video = make('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    return video;
  }

  // The image the page shows reports the size it's shown at when the browser picked it from a srcset, not its
  // own, so the size comes from loading it afresh, from the cache when it's the same file.
  function open() {
    timer = 0;
    const target = hovered;
    if (!target) return;
    spinnerTimer = setTimeout(showSpinner, SPINNER_AFTER, true);
    fetchMedia(target.urls, (media) => {
      if (target !== hovered) return;
      const box = media && placePopup(sizeOf(media), pointer, viewport(), target.shownSize);
      if (!box || !isWorthShowing(box, target.shownSize)) {
        dismiss();
        return;
      }
      gallery = galleryOf(target.el);
      showMedia(target, media, box);
      preloadAround();
    });
  }

  // Moves `step` images through the gallery. The image shown stays until the next one's size is known.
  function go(step) {
    if (!gallery || !shown) return;
    const from = gallery.index;
    const to = from + step;
    if (to < 0 || to >= gallery.items.length) return;
    const target = hovered;
    const item = gallery.items[to];
    gallery.index = to;
    counter.textContent = to + 1 + ' / ' + gallery.items.length;
    clearTimeout(spinnerTimer);
    spinnerTimer = setTimeout(showSpinner, SPINNER_AFTER, false);
    fetchMedia(item.urls, (media) => {
      if (target !== hovered || !gallery || gallery.index !== to) return;
      const box = media && placePopup(sizeOf(media), pointer, viewport());
      if (box) {
        showMedia(item, media, box);
        preloadAround();
        return;
      }
      // Nothing to show for this one: back to the one still shown.
      clearTimeout(spinnerTimer);
      spinner.style.display = 'none';
      gallery.index = from;
      counter.textContent = from + 1 + ' / ' + gallery.items.length;
    });
  }

  // The gallery's images on either side of the one shown. Videos aren't loaded in advance: they're large.
  function preloadAround() {
    preloaded.forEach(release);
    preloaded = [];
    if (!gallery) return;
    [gallery.index + 1, gallery.index - 1].forEach((index) => {
      const item = gallery.items[index];
      if (!item || !item.urls.length || isVideoFileUrl(item.urls[0])) return;
      const img = make('img');
      img.src = item.urls[0];
      preloaded.push(img);
    });
  }

  // ---- Moving through a gallery ----

  let wheelListening = false;
  let wheelTotal = 0;
  let wheelLast = -Infinity;
  let wheelSpent = false;

  // Moving the fingers (or the wheel) down shows the next image. One image per gesture, so a trackpad swipe and
  // its momentum move one image, not several. Past either end, a new gesture scrolls the page as usual, which
  // closes the popup.
  function onWheel(event) {
    if (!shown || !gallery || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const step = Math.sign(event.deltaY) * (NATURAL_SCROLLING ? -1 : 1) * (reverseWheel ? -1 : 1);
    if (!step) return;
    if (event.timeStamp - wheelLast > WHEEL_SETTLE) {
      wheelTotal = 0;
      wheelSpent = false;
    }
    wheelLast = event.timeStamp;
    const to = gallery.index + step;
    if (!wheelSpent && (to < 0 || to >= gallery.items.length)) return;
    event.preventDefault();
    event.stopPropagation();
    if (wheelSpent) return;
    wheelTotal += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1);
    if (Math.abs(wheelTotal) < WHEEL_STEP) return;
    wheelSpent = true;
    go(step);
  }

  // Listening to the wheel in a way that can stop the page scrolling makes the browser wait on every turn of the
  // wheel, so it only listens while a gallery is open.
  function listenToWheel(on) {
    if (on === wheelListening) return;
    wheelListening = on;
    if (on) window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    else window.removeEventListener('wheel', onWheel, { capture: true });
  }

  const isTyping = (target) =>
    !!target && (target.isContentEditable || /^(?:input|textarea|select)$/.test(target.localName || ''));

  // ---- Saving ----

  // Saves the image or video the popup shows, as the full-size file it came from. The background script does the
  // download: content scripts can't.
  async function save() {
    if (!shown || !full) return;
    const url = full.currentSrc || full.src;
    let result = 'failed';
    try {
      result = await browser.runtime.sendMessage({ type: 'save', url, filename: fileNameFor(url) });
    } catch (err) {
      // No background script to answer.
    }
    note({ saved: 'Saved', canceled: 'Not saved' }[result] || "Couldn't save");
  }

  // ---- Video ----

  // M: the sound on or off. Firefox knows whether a video has any.
  function toggleSound(video) {
    if (video.mozHasAudio === false) {
      note('No sound');
      return;
    }
    video.muted = !video.muted;
    note(video.muted ? 'Sound off' : 'Sound on');
  }

  // Space: pause, or play again.
  function togglePause(video) {
    if (video.paused) {
      resume(video, "Firefox didn't allow it to play");
      note('Playing');
    } else {
      video.pause();
      note('Paused');
    }
  }

  // ---- Following the pointer ----

  function update() {
    frame = 0;
    if (!enabled) return;
    const found = findImage(pointer.x, pointer.y);
    const el = found ? found.el : null;
    if (dismissed && el !== dismissed) dismissed = null;
    if (el && el === dismissed) return;
    if (hovered && found && hovered.el === el && hovered.urls[0] === found.urls[0]) return;
    if (hovered || shown) hide();
    if (!found) return;
    hovered = found;
    timer = setTimeout(open, DELAY);
  }

  function onMove(event) {
    pointer = { x: event.clientX, y: event.clientY };
    // A button held down means dragging or selecting, not looking.
    if (event.buttons) {
      if (hovered) dismiss();
      return;
    }
    if (enabled && !frame) frame = requestAnimationFrame(update);
  }

  const passive = { capture: true, passive: true };
  window.addEventListener('mousemove', onMove, passive);
  window.addEventListener('mousedown', () => hovered && dismiss(), passive);
  // Scrolling closes the popup when it moves the image: the page scrolling, or a box the image is in. Other boxes
  // scrolling, such as a chat or a ticker, leave it open.
  window.addEventListener(
    'scroll',
    (event) => {
      if (!hovered && !shown) return;
      const box = event.target;
      if (box === document || !hovered || (box.nodeType === Node.ELEMENT_NODE && containsAcross(box, hovered.el))) hide();
    },
    passive
  );
  window.addEventListener('blur', () => (hovered || shown) && hide());
  document.addEventListener('visibilitychange', () => document.hidden && hide());
  // Leaving the window (or entering a frame in it).
  document.addEventListener('mouseout', (event) => !event.relatedTarget && (hovered || shown) && hide(), passive);
  // Escape closes the popup, ← → move through a gallery, S saves, and for a video M turns the sound on or off and
  // Space pauses, without the keys also reaching the page, which might close a dialog, move a carousel, scroll or
  // have shortcuts of its own.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!hovered) return;
      if (event.key === 'Escape') {
        if (shown) event.stopPropagation();
        dismiss();
        return;
      }
      if (!shown || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      const step = gallery ? { ArrowRight: 1, ArrowLeft: -1 }[event.key] : 0;
      const key = event.key.toLowerCase();
      const video = isVideo(full) ? full : null;
      if (!step && key !== 's' && !(video && (key === 'm' || key === ' '))) return;
      event.preventDefault();
      event.stopPropagation();
      if (step) go(step);
      else if (event.repeat) return;
      else if (key === 's') save();
      else if (key === 'm') toggleSound(video);
      else togglePause(video);
    },
    true
  );

  // ---- Settings ----

  // Whether this site is one to leave alone, and which way the wheel goes, from the background script. With no
  // answer, as when it isn't up yet, Largitude works with the defaults rather than stay off for good.
  async function loadSettings() {
    let settings = null;
    try {
      settings = await browser.runtime.sendMessage({ type: 'settings' });
    } catch (err) {
      settings = null;
    }
    enabled = !(settings && settings.excluded);
    reverseWheel = !!(settings && settings.reverseWheel);
    if (!enabled) hide();
  }

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.options) loadSettings();
  });
  loadSettings();
})();
