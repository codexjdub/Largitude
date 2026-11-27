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

  const DELAY = hoverDelayOf('normal'); // ms the pointer rests on an image before the popup opens, unless set
  const SPINNER_AFTER = 150; // ms an image may take to start arriving before a spinner shows
  const MIN_SIZE = 24; // px: smaller images, such as icons and emoji, are left alone
  const MAX_LAYERS = 8; // elements under the pointer looked through for an image
  const WHEEL_STEP = 40; // px of wheel movement that moves to the next image in a gallery
  const WHEEL_SETTLE = 150; // ms without wheel movement that ends a gesture, which moves one image at most
  const SHOWABLE_TYPES = /^image\/(?:jpeg|png|gif|webp|avif|bmp|svg\+xml)$/i;
  const HINT_ROOM = 32; // px kept under the popup for the line of keys: its 26 and the 6 between them

  let enabled = false;
  let delay = DELAY; // the "Wait before showing" setting
  let reverseWheel = false; // the "Reverse the mouse wheel in galleries" setting
  let keysUnder = true; // the "Show keys under the popup" setting
  let pointer = { x: 0, y: 0 };
  let frame = 0; // the animation frame that will look under the pointer
  let hovered = null; // the image or video under the pointer: { el, thumb, thumbSize, urls, videos, streamed, shownSize }
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

  // The image or video under the point, unless the site rules leave it to the site, as YouTube's own thumbnails
  // on YouTube, which play a preview of their own.
  function findImage(x, y) {
    const found = findAnyImage(x, y);
    const own = found && [found.thumb].concat(found.urls).some((url) => !!url && isLeftAlone(url, location.href));
    return own ? null : found;
  }

  function findAnyImage(x, y) {
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
    if (el.localName === 'video') found = videoSourcesOf(el) || streamedVideoOf(el);
    else if (el.localName === 'img') found = streamedVideoOf(el) || loadable(sourcesOf(el));
    else found = loadable(backgroundSourcesOf(el));
    return found && { ...found, el, shownSize: { width: rect.width, height: rect.height } };
  }

  // `found`, if the image the page shows is at an address an image can load from.
  const loadable = (found) => (found && /^(?:https?|data|blob):/i.test(found.thumb) ? found : null);

  // A CSS background image, after a link around the element to an image or video file.
  function backgroundSourcesOf(el) {
    const background = backgroundOf(el);
    if (!background) return null;
    return { thumb: background, thumbSize: null, urls: withRules([linkedMedia(el), background]) };
  }

  // The addresses to try for an <img>'s full size, best first: an original the page lists elsewhere, a link
  // around it to an image file, the largest in its srcset, then what it shows. Lazy-loading pages keep the last
  // two in data-lazy-src and data-lazy-srcset until the image comes into view.
  function sourcesOf(img) {
    const lazy = img.getAttribute('data-lazy-src');
    const thumb = img.currentSrc || img.src || (lazy ? absolute(lazy, img) : '');
    const largest = largestCandidate(srcsetOf(img));
    return {
      thumb,
      thumbSize: img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null,
      urls: withRules([listedOriginal(img), linkedMedia(img), largest ? largest.url : '', thumb]),
    };
  }

  // The original of an <img> that the page lists somewhere other than its address, from the site rules, as
  // Google Images does for its results.
  function listedOriginal(img) {
    for (const site of SITES) {
      const found = site.original ? site.original(img) : '';
      if (found) return found;
    }
    return '';
  }

  // A video the page plays from a file, which the popup plays again, bigger, with the page's poster as its own
  // until it starts. The file is a video whatever its address looks like (`videos`). A streaming player's video
  // has a blob: address, put together piece by piece, which can't be played anywhere else, so it's left alone,
  // unless the site rules know of files of it (streamedVideoOf).
  function videoSourcesOf(video) {
    const source = video.querySelector('source[src]');
    const src = video.currentSrc || video.src || (source ? source.src : '');
    if (!/^https?:/i.test(src)) return null;
    return { thumb: video.poster || '', thumbSize: null, urls: withRules([src]), videos: [src] };
  }

  // A video the page streams, from files of it that the site rules know of, as Reddit's player lists. `el` is
  // the page's <video>, or the poster shown in its place before it plays. The files are the video the page
  // plays (`streamed`), so the popup starts where the page's is.
  function streamedVideoOf(el) {
    for (const site of SITES) {
      const found = site.video ? site.video(el, page) : null;
      if (found && found.urls.length) {
        return { thumb: found.poster || '', thumbSize: null, urls: found.urls, videos: found.urls, streamed: true };
      }
    }
    return null;
  }

  // Each address preceded by any larger version the site rules know of, without repeats.
  function withRules(addresses) {
    const urls = [];
    addresses.forEach((address) => {
      if (!address) return;
      largerVersions(address)
        .concat(address)
        .forEach((url) => {
          if (urls.indexOf(url) === -1) urls.push(url);
        });
    });
    return urls;
  }

  // The site rules' larger versions of an address. The same few addresses come up on every frame the mouse moves
  // over an image, so the answers are kept, for a few hundred addresses at most. The rules are for http(s)
  // addresses only, which also keeps long data: addresses out.
  const rulesCache = new Map();
  function largerVersions(url) {
    if (!/^https?:/i.test(url)) return [];
    let urls = rulesCache.get(url);
    if (!urls) {
      if (rulesCache.size >= 500) rulesCache.clear();
      urls = fullSizeUrls(url);
      rulesCache.set(url, urls);
    }
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
    return colorAlpha(getComputedStyle(el).backgroundColor) > 0.5;
  }

  function imageInside(el, x, y) {
    const rect = el.getBoundingClientRect();
    const view = viewport();
    if (rect.width > view.width / 2 || rect.height > view.height / 2) return null;
    const images = mediaInside(el, 20);
    for (let i = 0; i < images.length; i++) {
      const box = images[i].getBoundingClientRect();
      if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) continue;
      const found = imageOf(images[i]);
      if (found) return found;
    }
    return null;
  }

  // The first `max` images and videos inside `el`, in its shadow roots and theirs too, as layersAt looks: closed
  // ones included. A few hundred elements are looked through at most, `el` being a small one.
  function mediaInside(el, max) {
    const found = [];
    let looked = 0;
    const visit = (scope, depth) => {
      const shadow = depth < 4 && scope.nodeType === Node.ELEMENT_NODE && (scope.openOrClosedShadowRoot || scope.shadowRoot);
      if (shadow) visit(shadow, depth + 1);
      const all = scope.querySelectorAll('*');
      for (let i = 0; i < all.length && found.length < max && looked < 500; i++, looked++) {
        const node = all[i];
        if (node.localName === 'img' || node.localName === 'video') found.push(node);
        const inner = depth < 4 && (node.openOrClosedShadowRoot || node.shadowRoot);
        if (inner) visit(inner, depth + 1);
      }
    };
    visit(el, 0);
    return found;
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
    return isImageFileUrl(url) || isVideoFileUrl(url) || largerVersions(url).length > 0;
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
  let stage = null; // the popup's box, which the image or video, the counter and the notes stay inside
  let hint = null; // the line of keys under the popup
  let keysPanel = null; // every key, over the popup, while ? has it open
  let thumbImg = null;
  let full = null; // the full-size <img> or <video> in the popup
  let spinner = null;
  let counter = null;
  let progress = null;
  let progressDone = 0; // the share of the video the bar last showed as played
  let toast = null;
  let toastTimer = 0;
  let videoState = null; // a video's corner: whether its sound is off, and whether it's paused
  let dots = null; // a gallery's dots, one for each image, under the image
  let fadeTimer = 0; // while the popup fades out, what's left to do once it has
  let fading = null; // the image or video the popup fades out with
  let actualSize = null; // with Z, the popup's box from before it showed the image at its actual size
  let turns = 0; // the quarter turns clockwise the image or video shown is turned (R), once mirrored (F)
  let flipped = false; // whether F has mirrored the image or video shown left to right
  let uprightBox = null; // the popup's box before R turned it
  let keysOpen = false;
  let hostBox = null; // where the popup was last placed, which its transform doesn't change while it grows or turns
  let spinnerOnly = false; // whether the popup is only the spinner beside the pointer, before the first image
  let leaving = null; // a gallery's image sliding out as the next slides in
  let current = null; // what the popup shows: the hovered image or video, or one of its gallery's
  let sizeTag = null; // the image's size, in the corner for a moment once the popup opens
  let sizeTagTimer = 0;
  let infoPanel = null; // I's details about the image or video shown, over the popup
  let infoOpen = false;
  let hintTimer = 0;
  const savedNames = new Map(); // the files S saved from this page, by address, with the names they were saved under
  let saveAgain = ''; // the address S was just told was saved already, which S again saves another copy of
  let saveAgainTimer = 0;

  const make = (tag) => document.createElement(tag);
  const setStyles = (el, styles, important) =>
    Object.keys(styles).forEach((name) => el.style.setProperty(name, styles[name], important ? 'important' : ''));
  const FILL = { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', margin: '0', transform: 'none' };
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  // What each key does, for the panel ? opens, in groups.
  const KEYS = [
    ['Viewing', [['← →', 'Move through a gallery'], ['Z', 'Actual size'], ['R', 'Turn a quarter turn'], ['F', 'Flip left to right']]],
    ['Saving', [['S', 'Save'], ['O', 'Open in a new tab'], ['C', 'Copy the image'], ['Shift C', 'Copy the address']]],
    ['Video', [['M', 'Sound on or off'], ['Space', 'Pause or play'], ['← →', 'Back or on 5 seconds']]],
    ['The popup', [['I', 'Details: size, type, file'], ['?', 'Show or hide these keys'], ['Esc', 'Close']]],
  ];
  // How long the popup takes to fade in or out, and to grow, shrink, turn, flip or slide to a gallery's next image;
  // none of it for those who'd rather see less motion.
  const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FADE = STILL ? 0 : 120;
  const MOTION = STILL ? 0 : 200;
  const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  const TRANSITION = `opacity ${FADE}ms ease-out, transform ${MOTION}ms ${EASE}`;
  const HINT_GAP = 6; // px between the popup and the line of keys under it
  const SEEK_STEP = 5; // seconds ← → move a video back or on
  // Behind an image, a checkerboard of two middle grays, so a transparent image shows, its dark parts and its
  // light ones.
  const CHECKERBOARD = {
    'background-color': '#38383b',
    'background-image': 'conic-gradient(#545458 25%, transparent 0 50%, #545458 0 75%, transparent 0)',
    'background-size': '16px 16px',
  };
  const MAX_DOTS = 12; // a gallery with more images shows only its counter

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
        overflow: 'visible',
        'pointer-events': 'none',
        'border-radius': '4px',
        background: '#1c1c1e',
        'box-shadow': '0 0 0 1px rgba(0, 0, 0, 0.25), 0 12px 40px rgba(0, 0, 0, 0.45)',
        opacity: '0',
        transform: 'none',
        'transform-origin': '50% 50%',
        transition: TRANSITION,
      },
      true
    );
    const shadow = host.attachShadow({ mode: 'open' });
    stage = make('div');
    setStyles(stage, { ...FILL, overflow: 'hidden', 'border-radius': '4px', ...CHECKERBOARD });
    // The thumbnail, standing in while the full image arrives over it, blurred, so the full image seems to come
    // into focus; a little larger than the popup, so the blur's soft edges are out of sight.
    thumbImg = make('img');
    thumbImg.alt = '';
    setStyles(thumbImg, { ...FILL, filter: 'blur(8px)', transform: 'scale(1.06)' });
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
      'max-width': 'calc(100% - 44px)',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      display: 'none',
    });
    // In a video's top left corner, whether its sound is off and whether it's paused, as icons.
    videoState = make('div');
    setStyles(videoState, {
      position: 'absolute',
      'z-index': '1',
      top: '8px',
      left: '8px',
      gap: '6px',
      padding: '4px 7px',
      'border-radius': '10px',
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'none',
    });
    const muted = icon([{ d: 'M2 5.5h3L9 2.5v11l-4-3H2z' }, { d: 'M11 5.5l4 5M15 5.5l-4 5', stroke: true }]);
    const paused = icon([{ d: 'M3.5 3h3v10h-3zM9.5 3h3v10h-3z' }]);
    videoState.append(muted, paused);
    // Under a gallery's image, a dot for each image, the one shown brighter.
    dots = make('div');
    setStyles(dots, {
      position: 'absolute',
      'z-index': '1',
      left: '50%',
      bottom: '10px',
      transform: 'translateX(-50%)',
      gap: '6px',
      padding: '4px 7px',
      'border-radius': '8px',
      background: 'rgba(0, 0, 0, 0.35)',
      display: 'none',
    });
    // The image's size, and how much bigger than the thumbnail, for a moment once the popup opens.
    sizeTag = make('div');
    setStyles(sizeTag, {
      position: 'absolute',
      'z-index': '1',
      top: '8px',
      left: '8px',
      padding: '2px 8px',
      'border-radius': '10px',
      background: 'rgba(0, 0, 0, 0.6)',
      color: '#fff',
      font: `600 12px/18px ${FONT}`,
      'font-variant-numeric': 'tabular-nums',
      'white-space': 'nowrap',
      transition: `opacity ${FADE * 2}ms ease-out`,
      display: 'none',
    });
    stage.append(thumbImg, spinner, counter, progress, videoState, dots, sizeTag, toast);
    // Centered under the popup.
    hint = make('div');
    setStyles(hint, {
      position: 'absolute',
      top: `calc(100% + ${HINT_GAP}px)`,
      left: '50%',
      transform: 'translateX(-50%)',
      gap: '10px',
      padding: '4px 12px',
      'border-radius': '13px',
      background: 'rgba(0, 0, 0, 0.75)',
      color: 'rgba(255, 255, 255, 0.9)',
      font: `12px/18px ${FONT}`,
      'white-space': 'nowrap',
      display: 'none',
    });
    // Centered on the popup, and larger than a small one.
    const PANEL = {
      position: 'absolute',
      'z-index': '2',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      'grid-template-columns': 'auto auto',
      padding: '14px 16px 12px',
      'border-radius': '8px',
      background: 'rgba(20, 20, 22, 0.92)',
      'backdrop-filter': 'blur(8px)',
      'box-shadow': '0 0 0 1px rgba(255, 255, 255, 0.08)',
      color: 'rgba(255, 255, 255, 0.9)',
      font: `13px/20px ${FONT}`,
      'white-space': 'nowrap',
      display: 'none',
    };
    keysPanel = make('div');
    setStyles(keysPanel, { ...PANEL, gap: '12px 24px' });
    // The keys in groups, two groups across: a heading, then each key beside what it does.
    KEYS.forEach(([title, keys]) => {
      const group = make('div');
      // The keys' column as wide in every group, so what they do lines up across groups.
      setStyles(group, {
        display: 'grid',
        'grid-template-columns': 'minmax(56px, max-content) auto',
        gap: '4px 10px',
        'align-content': 'start',
        'align-items': 'baseline',
      });
      const heading = label(title);
      setStyles(heading, {
        'grid-column': '1 / -1',
        color: 'rgba(255, 255, 255, 0.55)',
        font: `600 11px/16px ${FONT}`,
        'letter-spacing': '0.04em',
        'text-transform': 'uppercase',
      });
      group.append(heading);
      keys.forEach(([key, what]) => group.append(keycap(key), label(what)));
      keysPanel.append(group);
    });
    const footnote = label("Largitude's settings turn the keys under the popup on or off.");
    setStyles(footnote, { 'grid-column': '1 / -1', color: 'rgba(255, 255, 255, 0.55)', font: `12px/18px ${FONT}` });
    keysPanel.append(footnote);
    // I's details, each a name and what it is, filled in as it opens.
    infoPanel = make('div');
    setStyles(infoPanel, { ...PANEL, gap: '4px 14px' });
    shadow.append(stage, hint, keysPanel, infoPanel);
  }

  // A 16 × 16 icon, drawn in white: each of `shapes` is a path filled, or with `stroke`, drawn as a line.
  function icon(shapes) {
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    setStyles(svg, { display: 'block' });
    shapes.forEach((shape) => {
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', shape.d);
      if (shape.stroke) {
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#fff');
        path.setAttribute('stroke-width', '1.6');
        path.setAttribute('stroke-linecap', 'round');
      } else {
        path.setAttribute('fill', '#fff');
      }
      svg.append(path);
    });
    return svg;
  }

  function keycap(key) {
    const cap = make('b');
    setStyles(cap, {
      'justify-self': 'start',
      padding: '0 5px',
      'border-radius': '4px',
      background: 'rgba(255, 255, 255, 0.18)',
      color: '#fff',
      font: '500 11px/18px ui-monospace, Menlo, Consolas, monospace',
    });
    cap.textContent = key;
    return cap;
  }

  function label(words) {
    const span = make('span');
    span.textContent = words;
    return span;
  }

  function note(text, ms = 1500) {
    if (!shown) return;
    toast.textContent = text;
    toast.style.display = 'block';
    // Above a gallery's dots.
    toast.style.bottom = dots.style.display === 'none' ? '10px' : '30px';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, ms);
  }

  // Lights up the keycap for `key` (as the keycaps name it: "S", "← →") in the line of keys and the panel of keys,
  // where they show, so the key just pressed is seen to have done its part.
  function flashKey(key) {
    [hint, keysPanel].forEach((box) => {
      if (!box || box.style.display === 'none') return;
      box.querySelectorAll('b').forEach((cap) => {
        if (cap.textContent !== key) return;
        cap.animate([{ background: '#fff', color: '#1c1c1e' }, { background: 'rgba(255, 255, 255, 0.18)', color: '#fff' }], { duration: 450, easing: 'ease-out' });
      });
    });
  }

  // Puts the popup at `box`. Appearing, it fades in, growing out of the thumbnail `from` when there is one.
  function placeHost(box, from) {
    if (!host) createHost();
    if (!host.isConnected) root.append(host);
    // One fading out is done with at once.
    if (fadeTimer) finishHiding();
    const appearing = host.style.display === 'none';
    setStyles(
      host,
      { display: 'block', left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' },
      true
    );
    hostBox = { left: box.left, top: box.top, width: box.width, height: box.height };
    // Shown afresh each time, it goes above whatever the page has put in the top layer since.
    try {
      if (!host.matches(':popover-open')) host.showPopover();
    } catch (err) {
      // Removed by the page in the meantime: it goes back in next time.
    }
    const grow = MOTION && from ? growTransform(from, box) : '';
    if (appearing || grow) startAt(grow || 'none');
    host.style.setProperty('opacity', '1', 'important');
    host.style.setProperty('transform', 'none', 'important');
    if (hint.style.display !== 'none') keepInWindow(hint);
    if (keysOpen) keepInWindow(keysPanel);
    if (infoOpen) keepInWindow(infoPanel);
  }

  // Puts the popup at `transform` at once, laid out as it's seen there, to move from there into place.
  function startAt(transform) {
    host.style.setProperty('transition', 'none', 'important');
    host.style.setProperty('transform', transform, 'important');
    host.getBoundingClientRect();
    host.style.setProperty('transition', TRANSITION, 'important');
  }

  // The popup, placed already, moving into place from `transform`. The line of keys under it stays out of sight
  // meanwhile, rather than turn or flip with it.
  function settleFrom(transform) {
    if (!MOTION) return;
    startAt(transform);
    host.style.setProperty('transform', 'none', 'important');
    hint.style.visibility = 'hidden';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint.style.visibility = ''), MOTION);
  }

  // `el`'s place on the screen, or null for one gone from the page or out of sight.
  function rectOf(el) {
    if (!el || !el.isConnected) return null;
    const rect = el.getBoundingClientRect();
    return rect.width && rect.height ? rect : null;
  }

  // Moves `el`, centered on the popup or under it, as little as needed to stay inside the window. Worked out from
  // where the popup was placed, since while it grows or turns, it isn't there yet.
  function keepInWindow(el) {
    const view = viewport();
    const [width, height] = [el.offsetWidth, el.offsetHeight];
    const left = hostBox.left + (hostBox.width - width) / 2;
    const top = el === hint ? hostBox.top + hostBox.height + HINT_GAP : hostBox.top + (hostBox.height - height) / 2;
    const shift = (start, end, room) => Math.max(8 - start, Math.min(0, room - 8 - end));
    el.style.marginLeft = shift(left, left + width, view.width) + 'px';
    el.style.marginTop = shift(top, top + height, view.height) + 'px';
  }

  // The line of keys under the popup, with the setting on: a few for what it shows, the ones used most, and ? for
  // the rest. Not at actual size, where the popup fills the window.
  function showHint() {
    if (!keysUnder || actualSize || !full) {
      hint.style.display = 'none';
      return;
    }
    // C only where it can copy the image, on https pages.
    const copy = canCopyImages() ? [['C', 'copy']] : [];
    const keys = isVideo(full)
      ? [['M', 'sound'], ['Space', 'pause'], ...(gallery ? [] : [['← →', 'skip']]), ['S', 'save']]
      : gallery
        ? [['← →', 'next'], ['S', 'save'], ...copy]
        : [['S', 'save'], ...copy, ['Z', 'actual size']];
    hint.replaceChildren(
      ...keys.concat([['?', 'all keys']]).map(([key, what]) => {
        const item = label(' ' + what);
        item.prepend(keycap(key));
        return item;
      })
    );
    hint.style.display = 'flex';
    keepInWindow(hint);
  }

  // The room to keep under the popup for the line of keys.
  const hintRoom = () => (keysUnder ? HINT_ROOM : 0);

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
    checkered(false);
    spinnerOnly = true;
    placeHost({
      left: Math.max(0, Math.min(pointer.x + 16, view.width - size - 8)),
      top: Math.max(0, Math.min(pointer.y + 16, view.height - size - 8)),
      width: size,
      height: size,
    });
  }

  // Shows `media`, an image or video whose size is known, for `item` (the hovered image or video, or one of its
  // gallery's). Appearing, the popup grows out of the thumbnail; `slide`, 1 or -1, slides a gallery's next or
  // previous image in from that side, the one shown going out the other.
  function showMedia(item, media, box, slide = 0) {
    clearTimeout(spinnerTimer);
    spinnerTimer = 0;
    if (!host) createHost();
    const before = hostBox;
    const turnedBefore = turns || flipped;
    const appearing = host.style.display === 'none' || !!fadeTimer || spinnerOnly;
    actualSize = null;
    turns = 0;
    flipped = false;
    uprightBox = null;
    spinnerOnly = false;
    current = item;
    spinner.style.display = 'none';
    // The thumbnail, already loaded, stands in while the full image arrives over it, if it's the same shape, and
    // goes once the image has arrived, so it doesn't show through its transparent parts. A video shows it as its
    // poster until the first frame, which keeps the thumbnail's own shape.
    const video = isVideo(media);
    if (!video && !media.complete && item.thumb && item.thumb !== media.src && item.thumbSize && sameShape(item.thumbSize, sizeOf(media))) {
      thumbImg.src = item.thumb;
      thumbImg.style.display = 'block';
      media.addEventListener('load', () => media === full && (thumbImg.style.display = 'none'), { once: true });
    } else {
      thumbImg.removeAttribute('src');
      thumbImg.style.display = 'none';
    }
    if (video && item.thumb) media.poster = item.thumb;
    const sliding = !!(MOTION && slide && full && full !== media && shown && before && !turnedBefore);
    if (full !== media) {
      if (sliding) slideOut(full, slide, before, box);
      else if (full) drop(full);
      full = media;
      stage.insertBefore(media, spinner);
    }
    setStyles(media, FILL);
    media.style.display = 'block';
    // The checkerboard shows through an image's transparent parts; a video has none.
    checkered(!video);
    if (gallery) counter.textContent = gallery.index + 1 + ' / ' + gallery.items.length;
    counter.style.display = gallery ? 'block' : 'none';
    placeHost(box, appearing && item.el ? rectOf(item.el) : null);
    if (sliding) {
      slideIn(media, slide);
      if (thumbImg.style.display !== 'none') slideIn(thumbImg, slide);
    }
    shown = true;
    showHint();
    showDots();
    listenToWheel(!!gallery);
    // The progress bar starts afresh for a video, and goes for an image.
    progressDone = 0;
    showProgress();
    if (video) play(media, item);
    showVideoState();
    sizeTag.style.display = 'none';
    showInfo();
  }

  // A gallery's image going out towards the side away from `step`, at the size it was shown at in the popup's box
  // `before`, centered in the new one, `box`.
  function slideOut(old, step, before, box) {
    if (leaving) drop(leaving);
    leaving = old;
    setStyles(old, {
      left: (box.width - before.width) / 2 + 'px',
      top: (box.height - before.height) / 2 + 'px',
      width: before.width + 'px',
      height: before.height + 'px',
    });
    const out = old.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-step * 30}%)`, opacity: 0 }], {
      duration: MOTION,
      easing: EASE,
      fill: 'forwards',
    });
    out.onfinish = () => leaving === old && drop(old);
  }

  // `el` coming in from the side of `step`.
  function slideIn(el, step) {
    el.animate([{ transform: `translateX(${step * 30}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: MOTION, easing: EASE });
  }

  // `media` out of the popup, and no longer loading.
  function drop(media) {
    if (leaving === media) leaving = null;
    media.remove();
    release(media);
  }

  // The image's size, and how much bigger than its thumbnail, in the corner for a moment, beside a video's icons.
  function showSizeTag() {
    if (!shown || !full || !current) return;
    const natural = sizeOf(full);
    sizeTag.textContent = sizeLabel(natural, sizeFactor(natural, current.thumbSize, current.shownSize, devicePixelRatio || 1));
    sizeTag.style.left = videoState.style.display === 'none' ? '8px' : 8 + videoState.offsetWidth + 6 + 'px';
    sizeTag.style.opacity = '1';
    sizeTag.style.display = 'block';
    clearTimeout(sizeTagTimer);
    sizeTagTimer = setTimeout(() => {
      sizeTag.style.opacity = '0';
      sizeTagTimer = setTimeout(() => (sizeTag.style.display = 'none'), FADE * 2);
    }, 1600);
  }

  // The popup's box with the checkerboard behind an image, or plain and dark.
  function checkered(on) {
    setStyles(stage, on ? CHECKERBOARD : { 'background-color': '#1c1c1e', 'background-image': 'none' });
  }

  // A gallery's dots, the one for the image shown brighter; none for a gallery too long for them to help.
  function showDots() {
    const count = gallery ? gallery.items.length : 0;
    if (count < 2 || count > MAX_DOTS) {
      dots.style.display = 'none';
      return;
    }
    if (dots.children.length !== count) {
      dots.replaceChildren(
        ...Array.from({ length: count }, () => {
          const dot = make('span');
          setStyles(dot, { display: 'block', width: '6px', height: '6px', 'border-radius': '50%' });
          return dot;
        })
      );
    }
    Array.prototype.forEach.call(dots.children, (dot, i) => {
      dot.style.background = i === gallery.index ? '#fff' : 'rgba(255, 255, 255, 0.4)';
    });
    dots.style.display = 'flex';
  }

  // A video's corner: an icon while its sound is off, unless it has none to turn on, and one while it's paused.
  function showVideoState() {
    const video = shown && isVideo(full) ? full : null;
    const [mutedIcon, pausedIcon] = videoState.children;
    const muted = !!video && video.muted && video.mozHasAudio !== false;
    const paused = !!video && video.paused;
    mutedIcon.style.display = muted ? 'block' : 'none';
    pausedIcon.style.display = paused ? 'block' : 'none';
    videoState.style.display = muted || paused ? 'flex' : 'none';
  }

  const isVideo = (media) => !!media && media.localName === 'video';
  const sizeOf = (media) =>
    isVideo(media) ? { width: media.videoWidth, height: media.videoHeight } : { width: media.naturalWidth, height: media.naturalHeight };
  const hasSize = (media) => sizeOf(media).width > 0 && sizeOf(media).height > 0;
  // A size as it is once turned `quarters` quarter turns.
  const turned = (size, quarters) => (quarters % 2 ? { width: size.height, height: size.width } : size);
  const sameShape = (a, b) => Math.abs(a.width / a.height - b.width / b.height) <= 0.03 * (b.width / b.height);
  // Whether `url`, one of `item`'s addresses, is a video: a video file by its name, or what a page's video plays.
  const isVideoAddress = (item, url) => isVideoFileUrl(url) || (!!item.videos && item.videos.indexOf(url) !== -1);

  // Starts the popup's video, from where the page's own is when it's that video: the same file, or a file of
  // the video the page streams.
  function play(video, item) {
    const pageVideo = item.el;
    const same = isVideo(pageVideo) && (item.streamed || (pageVideo.currentSrc || pageVideo.src) === video.src);
    if (same && pageVideo.currentTime > 0) video.currentTime = pageVideo.currentTime;
    resume(video, 'Autoplay is off on this site: Space plays');
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

  // The bar showing how far the popup's video has played, moved by the video's own events: a few times a second,
  // smoothed by a short transition, and straight back to the start when it loops. A video still loading, or one
  // that never says how long it is, has no progress to show.
  function showProgress() {
    if (!shown || !isVideo(full)) {
      progress.style.display = 'none';
      return;
    }
    const length = full.duration;
    const done = length > 0 && length < Infinity ? Math.min(1, full.currentTime / length) : 0;
    progress.style.transition = done < progressDone ? 'none' : 'width 0.25s linear';
    progressDone = done;
    progress.style.width = done * 100 + '%';
    progress.style.display = done > 0 ? 'block' : 'none';
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
    timer = spinnerTimer = sizeFrame = 0;
    // Releasing stops the download; the handlers below ignore an image or video that's no longer `loading`.
    const old = loading;
    loading = null;
    if (old && old !== full) release(old);
    preloaded.forEach(release);
    preloaded = [];
    const thumbnail = hovered && hovered.el;
    hovered = null;
    gallery = null;
    current = null;
    shown = false;
    actualSize = null;
    turns = 0;
    flipped = false;
    uprightBox = null;
    keysOpen = false;
    infoOpen = false;
    listenToWheel(false);
    if (!host) return;
    // The popup fades out as it is, shrinking back into its thumbnail, a video stopped at once, and then goes
    // (finishHiding), unless another popup comes first, which finishes it at once (placeHost).
    if (full) {
      if (isVideo(full)) full.pause();
      fading = full;
      full = null;
    }
    if (fadeTimer) return;
    if (FADE && host.style.display !== 'none') {
      const shrink = MOTION && !spinnerOnly && hostBox ? growTransform(rectOf(thumbnail), hostBox) : '';
      host.style.setProperty('opacity', '0', 'important');
      if (shrink) host.style.setProperty('transform', shrink, 'important');
      fadeTimer = setTimeout(finishHiding, FADE);
    } else {
      finishHiding();
    }
  }

  function finishHiding() {
    clearTimeout(fadeTimer);
    fadeTimer = 0;
    host.style.setProperty('opacity', '0', 'important');
    host.style.setProperty('display', 'none', 'important');
    host.style.setProperty('transform', 'none', 'important');
    try {
      host.hidePopover();
    } catch (err) {
      // Already hidden.
    }
    if (fading) {
      fading.remove();
      release(fading);
      fading = null;
    }
    if (leaving) drop(leaving);
    spinnerOnly = false;
    thumbImg.removeAttribute('src');
    counter.style.display = 'none';
    progress.style.display = 'none';
    hint.style.display = 'none';
    keysPanel.style.display = 'none';
    videoState.style.display = 'none';
    dots.style.display = 'none';
    clearTimeout(sizeTagTimer);
    sizeTag.style.display = 'none';
    infoPanel.style.display = 'none';
    clearTimeout(hintTimer);
    hint.style.visibility = '';
    clearTimeout(toastTimer);
    toast.style.display = 'none';
  }

  function dismiss() {
    if (hovered) dismissed = hovered.el;
    hide();
  }

  // ---- Loading ----

  // Loads the first of `item`'s addresses that works, as an <img>, or a <video> for a video, and calls `done`
  // with it as soon as its size is known, long before it has finished loading, so the popup opens at its final
  // size and the image fills in. `done` gets null when none works. Starting another load cancels this one.
  function fetchMedia(item, done, index = 0) {
    if (loading && loading !== full) release(loading);
    loading = null;
    if (index >= item.urls.length) {
      done(null);
      return;
    }
    const url = item.urls[index];
    const video = isVideoAddress(item, url);
    const media = video ? makeVideo() : make('img');
    loading = media;
    let sized = false;
    const ready = () => {
      if (sized || loading !== media || !hasSize(media)) return;
      // A site's stand-in for a file it doesn't have, such as YouTube's gray 120 × 90 still: on to the next.
      if (isStandIn(url, sizeOf(media))) {
        next();
        return;
      }
      sized = true;
      done(media);
    };
    // On to the next address. Once shown, the image or video stays if the rest of it doesn't come (a video's
    // connection lost partway, say), with a note.
    const next = () => {
      if (loading !== media) return;
      if (sized) note("Couldn't load the rest of it");
      else fetchMedia(item, done, index + 1);
    };
    // Loaded without a size, it can't be shown: a sound-only video, or an SVG with no width and height of its own
    // (which Firefox reports as 0 by 0). On to the next address then.
    const loaded = () => (hasSize(media) ? ready() : next());
    media.addEventListener('error', next);
    cancelAnimationFrame(sizeFrame);
    if (video) {
      media.addEventListener('loadedmetadata', loaded);
      media.src = url;
      return;
    }
    media.alt = '';
    media.addEventListener('load', loaded);
    media.src = url;
    const poll = () => {
      sizeFrame = 0;
      ready();
      if (!sized && loading === media && !media.complete) sizeFrame = requestAnimationFrame(poll);
    };
    poll();
  }

  // Muted, so it may play on its own, and looping, as a GIF does. Its progress shows on the popup's bar, and whether
  // it's muted or paused in its corner.
  function makeVideo() {
    const video = make('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    ['timeupdate', 'durationchange', 'emptied'].forEach((type) =>
      video.addEventListener(type, () => video === full && showProgress())
    );
    ['play', 'pause', 'volumechange'].forEach((type) => video.addEventListener(type, () => video === full && showVideoState()));
    return video;
  }

  // The image the page shows reports the size it's shown at when the browser picked it from a srcset, not its
  // own, so the size comes from loading it afresh, from the cache when it's the same file.
  function open() {
    timer = 0;
    const target = hovered;
    if (!target) return;
    spinnerTimer = setTimeout(showSpinner, SPINNER_AFTER, true);
    fetchMedia(target, (media) => {
      if (target !== hovered) return;
      const box = media && placePopup(sizeOf(media), pointer, viewport(), target.shownSize, hintRoom());
      if (!box || !isWorthShowing(box, target.shownSize)) {
        dismiss();
        return;
      }
      gallery = galleryOf(target.el);
      showMedia(target, media, box);
      showSizeTag();
      preloadAround();
    });
  }

  // Moves `step` images through the gallery. The image shown stays until the next one's size is known.
  function go(step) {
    if (!gallery || !shown) return;
    const from = gallery.index;
    const to = from + step;
    if (to < 0 || to >= gallery.items.length) {
      bump(step);
      return;
    }
    const target = hovered;
    const item = gallery.items[to];
    gallery.index = to;
    counter.textContent = to + 1 + ' / ' + gallery.items.length;
    showDots();
    clearTimeout(spinnerTimer);
    spinnerTimer = setTimeout(showSpinner, SPINNER_AFTER, false);
    fetchMedia(item, (media) => {
      if (target !== hovered || !gallery || gallery.index !== to) return;
      const box = media && placePopup(sizeOf(media), pointer, viewport(), null, hintRoom());
      if (box) {
        showMedia(item, media, box, step);
        preloadAround();
        return;
      }
      // Nothing to show for this one: back to the one still shown.
      clearTimeout(spinnerTimer);
      spinner.style.display = 'none';
      gallery.index = from;
      counter.textContent = from + 1 + ' / ' + gallery.items.length;
      showDots();
    });
  }

  // Past a gallery's last image, or before its first, the image nudges the way it was asked to go and springs back,
  // with the counter, to say there's no more that way; with less motion, a note says so.
  function bump(step) {
    if (!MOTION) {
      note(step > 0 ? 'This is the last one' : 'This is the first one');
      return;
    }
    if (stage.getAnimations().length) return;
    stage.animate([{ transform: 'none' }, { transform: `translateX(${-step * 16}px)` }, { transform: 'none' }], { duration: 280, easing: 'ease-out' });
    counter.animate([{ transform: 'none' }, { transform: 'scale(1.2)' }, { transform: 'none' }], { duration: 280, easing: 'ease-out' });
  }

  // The gallery's images on either side of the one shown. Videos aren't loaded in advance: they're large.
  function preloadAround() {
    preloaded.forEach(release);
    preloaded = [];
    if (!gallery) return;
    [gallery.index + 1, gallery.index - 1].forEach((index) => {
      const item = gallery.items[index];
      if (!item || !item.urls.length || isVideoAddress(item, item.urls[0])) return;
      const img = make('img');
      img.src = item.urls[0];
      preloaded.push(img);
    });
  }

  // ---- Actual size ----

  // Z shows the image at its actual size, filling the window, and moving the mouse looks around it. The popup
  // stays open meanwhile, wherever the pointer goes: Z again goes back to how it was, and Escape, a click or
  // scrolling the page close it as usual.
  function toggleActualSize() {
    if (!shown || !full) return;
    // Straight there, rather than finish turning on the way.
    if (actualSize) {
      const box = actualSize;
      actualSize = null;
      placeHost(box);
      startAt('none');
      fitToPopup(box);
      showHint();
      return;
    }
    const size = turned(sizeOf(full), turns);
    const box = hostBox;
    if (size.width <= Math.ceil(box.width) && size.height <= Math.ceil(box.height)) {
      note('Already at actual size');
      return;
    }
    actualSize = { left: box.left, top: box.top, width: box.width, height: box.height };
    thumbImg.style.display = 'none';
    hint.style.display = 'none';
    const view = viewport();
    placeHost({ left: 0, top: 0, width: view.width, height: view.height });
    startAt('none');
    lookAround();
  }

  // The part of the image to show for where the pointer is: with the pointer at the window's left edge, the
  // image's left edge shows, at the right edge its right edge, and so on. A side that fits in the window is
  // centered.
  function lookAround() {
    const size = turned(sizeOf(full), turns);
    const view = viewport();
    const offset = (length, room, at) => (length <= room ? (room - length) / 2 : (room - length) * Math.min(1, Math.max(0, at / room)));
    fitTurned({ left: offset(size.width, view.width, pointer.x), top: offset(size.height, view.height, pointer.y), ...size });
  }

  // ---- Turning ----

  // R turns the image or video a quarter turn clockwise, and four turns bring it back. The popup turns in place,
  // about its middle, where the eye is (turnInPlace); at actual size, the mouse looks around the turned image, and
  // Z goes back to the popup turned in place. Only the view turns: S, O and C take the file as it is. The next
  // image starts upright.
  function turn() {
    if (!shown || !full) return;
    finishSliding();
    if (!turns) {
      const box = actualSize || hostBox;
      uprightBox = { left: box.left, top: box.top, width: box.width, height: box.height };
    }
    turns = (turns + 1) % 4;
    const box = turnInPlace(uprightBox, turns, viewport(), hintRoom());
    // The thumbnail standing in for the full image doesn't turn with it.
    thumbImg.style.display = 'none';
    if (actualSize) {
      actualSize = box;
      lookAround();
      return;
    }
    const before = hostBox;
    placeHost(box);
    fitToPopup(box);
    // Seen turning, from where it was.
    settleFrom(turnTransform(before, box));
  }

  // F mirrors the image or video left to right as it's seen, after R too (turnsOnceFlipped). The popup keeps its
  // shape and place. Like R, it changes only the view, and the next image starts as it is.
  function flip() {
    if (!shown || !full) return;
    finishSliding();
    flipped = !flipped;
    turns = turnsOnceFlipped(turns);
    // The thumbnail standing in for the full image doesn't flip with it.
    thumbImg.style.display = 'none';
    if (actualSize) {
      lookAround();
      return;
    }
    fitToPopup(hostBox);
    // Seen turning over, as a card does, from its back, which shows it as it was.
    settleFrom('perspective(1600px) rotateY(0.5turn)');
  }

  // A gallery's image still sliding in or out, put where it's going, before R or F moves it.
  function finishSliding() {
    if (leaving) drop(leaving);
    [full, thumbImg].forEach((el) => el.getAnimations().forEach((animation) => animation.finish()));
  }

  // The image or video shown, turned and mirrored as R and F left it, covering `box`: a box in the popup, which at
  // actual size is the whole window.
  function fitTurned(box) {
    const unturned = unturnedBox(box, turns);
    setStyles(full, {
      left: unturned.left + 'px',
      top: unturned.top + 'px',
      width: unturned.width + 'px',
      height: unturned.height + 'px',
      transform: viewTransform(turns, flipped),
    });
  }

  // The image or video shown, filling the popup placed at `box`.
  function fitToPopup(box) {
    if (turns || flipped) fitTurned({ left: 0, top: 0, width: box.width, height: box.height });
    else setStyles(full, FILL);
  }

  // ---- Moving through a gallery ----

  let wheelListening = false;
  let wheelTotal = 0;
  let wheelLast = -Infinity;
  let wheelSpent = false;

  // The wheel moves through a gallery the way it scrolls the page: the turn or swipe that would scroll the page
  // down shows the next image, whichever way the computer's scrolling goes. One image per gesture, so a trackpad
  // swipe and its momentum move one image, not several. Past either end, a new gesture scrolls the page as usual,
  // which closes the popup.
  function onWheel(event) {
    if (!shown || !gallery || event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const step = Math.sign(event.deltaY) * (reverseWheel ? -1 : 1);
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

  // Whether the keyboard's focus is in a text field. A key pressed in a web component's text box seems to come from
  // the component itself, so the focus is followed into shadow roots: closed ones too, which Firefox lets
  // extensions see.
  function isTyping() {
    let el = document.activeElement;
    for (let depth = 0; el && depth < 8; depth++) {
      const shadow = el.openOrClosedShadowRoot || el.shadowRoot;
      if (!shadow || !shadow.activeElement) break;
      el = shadow.activeElement;
    }
    return !!el && (el.isContentEditable || /^(?:input|textarea|select)$/.test(el.localName || ''));
  }

  // ---- Saving ----

  // Saves the image or video the popup shows, as the full-size file it came from. The background script does the
  // download: content scripts can't.
  async function save() {
    if (!shown || !full) return;
    const url = full.currentSrc || full.src;
    // Saved already from this page: said so, rather than saved again under a numbered name, unless S comes again.
    if (savedNames.has(url) && saveAgain !== url) {
      const name = savedNames.get(url);
      saveAgain = url;
      clearTimeout(saveAgainTimer);
      saveAgainTimer = setTimeout(() => (saveAgain = ''), 3000);
      note(`Already saved${name ? ' as ' + shortened(name, 28) : ''} · S again for a copy`, 3000);
      return;
    }
    saveAgain = '';
    let answer = null;
    try {
      const file = await pageFile(url);
      answer = await browser.runtime.sendMessage({ type: 'save', url, filename: fileNameFor(url), file });
    } catch (err) {
      // No background script to answer, or no file to send.
    }
    // Saved under the name it was given, so it can be found in the downloads.
    const result = answer && answer.result;
    if (result === 'saved') savedNames.set(url, answer.name || '');
    if (result === 'saved') note(answer.name ? 'Saved ' + shortened(answer.name, 40) : 'Saved');
    else note(result === 'canceled' ? 'Not saved' : "Couldn't save");
  }

  // O: the full-size image or video in a new tab, next to this one, which the background script opens.
  async function openInTab() {
    if (!shown || !full) return;
    const url = full.currentSrc || full.src;
    let opened = false;
    try {
      opened = await browser.runtime.sendMessage({ type: 'open', url, file: await pageFile(url) });
    } catch (err) {
      // No background script to answer, or no file to send.
    }
    if (!opened) note("Couldn't open it");
  }

  // For S and O, the file at a data: or blob: address, which only the page can read, as { type, bytes } for the
  // background script; null for other addresses, which it loads itself. Where it can't be read again, the popup's
  // image is drawn into a PNG, as for C.
  async function pageFile(url) {
    if (/^https?:/i.test(url)) return null;
    try {
      const response = await fetch(url);
      if (response.ok) return { type: response.headers.get('content-type') || '', bytes: await response.arrayBuffer() };
    } catch (err) {
      // Drawn instead.
    }
    if (isVideo(full)) throw new Error('No file');
    const png = await canvasPng(full, full.naturalWidth, full.naturalHeight);
    return { type: 'image/png', bytes: await png.arrayBuffer() };
  }

  // Whether the clipboard takes images here: Firefox gives pages and the scripts on them the clipboard on https
  // pages only.
  const canCopyImages = () => !!navigator.clipboard && typeof ClipboardItem === 'function';

  // C: the image itself, on the clipboard, as a PNG, the one kind of image Firefox puts there. Firefox allows the
  // clipboard only while a key is being pressed, so the clipboard is handed the PNG to come.
  async function copyImage() {
    if (!shown || !full || isVideo(full)) return;
    if (!canCopyImages()) {
      note('Images can be copied on https pages only');
      return;
    }
    const png = pngOf(full);
    png.catch(() => {}); // the clipboard says it failed
    note('Copying…');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      note('Image copied');
    } catch (err) {
      note("Couldn't copy the image");
    }
  }

  // The popup's image as a PNG, drawn from the popup's own copy, so it's the image as shown, with nothing fetched
  // again. A canvas holding another site's image can't be read by the page, but Firefox lets an extension that may
  // read every site read it. Where it can't, the background script fetches the file, and anything but a PNG, by
  // its first bytes, is drawn into one.
  async function pngOf(img) {
    try {
      return await canvasPng(img, img.naturalWidth, img.naturalHeight);
    } catch (err) {
      // Not readable here: fetched instead.
    }
    const file = await browser.runtime.sendMessage({ type: 'image', url: img.currentSrc || img.src });
    if (!file) throw new Error("Couldn't fetch the image");
    if (isPngData(new Uint8Array(file.bytes, 0, Math.min(8, file.bytes.byteLength)))) {
      return new Blob([file.bytes], { type: 'image/png' });
    }
    const bitmap = await createImageBitmap(new Blob([file.bytes]));
    try {
      return await canvasPng(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  }

  // `image` drawn at `width` × `height` and saved as a PNG; it fails where the canvas can't be read.
  function canvasPng(image, width, height) {
    return new Promise((resolve, reject) => {
      const canvas = make('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No PNG'))), 'image/png');
    });
  }

  // Shift+C: the full-size image or video's address, on the clipboard. On http pages, which have no clipboard to
  // write to, as the Copy command copies text, while the key is being pressed.
  async function copyAddress() {
    if (!shown || !full) return;
    const address = full.currentSrc || full.src;
    let copied = false;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(address);
        copied = true;
      } else {
        copied = copyAsCommand(address);
      }
    } catch (err) {
      copied = false;
    }
    note(copied ? 'Address copied' : "Couldn't copy the address");
  }

  // `text` on the clipboard through the Copy command, whose copy event is handed the text instead of the page's
  // selection, and kept from the page's own copy handlers.
  function copyAsCommand(text) {
    const onCopy = (event) => {
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('copy', onCopy, true);
    try {
      return document.execCommand('copy');
    } finally {
      window.removeEventListener('copy', onCopy, true);
    }
  }

  // ?: every key, over the popup, until ? again or the popup closes. It stays open through a gallery.
  function toggleKeys() {
    if (!shown) return;
    keysOpen = !keysOpen;
    keysPanel.style.display = keysOpen ? 'grid' : 'none';
    if (keysOpen) keepInWindow(keysPanel);
    // One panel at a time.
    if (keysOpen && infoOpen) toggleInfo();
  }

  // I: details about the image or video shown, over the popup, until I again or the popup closes. It stays open
  // through a gallery, following the image shown.
  function toggleInfo() {
    if (!shown || !full) return;
    infoOpen = !infoOpen;
    if (infoOpen && keysOpen) toggleKeys();
    showInfo();
  }

  function showInfo() {
    if (!infoOpen || !shown || !full) {
      infoPanel.style.display = 'none';
      return;
    }
    const url = full.currentSrc || full.src;
    const natural = sizeOf(full);
    const page = /^(?:data|blob):/i.test(url);
    const rows = [
      ['Name', shortened(fileNameFor(url), 48)],
      ['Size', sizeLabel(natural, current ? sizeFactor(natural, current.thumbSize, current.shownSize, devicePixelRatio || 1) : 0)],
      ['Type', kindOfFile(url)],
      ['File', formatBytes(bytesOf(url))],
      ['Length', isVideo(full) && full.duration > 0 && full.duration < Infinity ? formatTime(full.duration) : ''],
      ['From', page ? 'this page' : hostOf(url)],
    ];
    infoPanel.replaceChildren(
      ...rows
        .filter(([, value]) => value)
        .flatMap(([name, value]) => {
          const term = label(name);
          term.style.color = 'rgba(255, 255, 255, 0.55)';
          return [term, label(value)];
        })
    );
    infoPanel.style.display = 'grid';
    keepInWindow(infoPanel);
  }

  // How big the file at `url` is, as far as Firefox says: for a file another site doesn't let pages time, nothing.
  function bytesOf(url) {
    try {
      const entries = performance.getEntriesByName(url);
      const entry = entries[entries.length - 1];
      return entry ? entry.encodedBodySize || entry.decodedBodySize || 0 : 0;
    } catch (err) {
      return 0;
    }
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

  // ← →: back or on a few seconds, in a video that isn't one of a gallery's, saying where it's got to.
  function seekBy(video, step) {
    const length = video.duration;
    if (!(length > 0) || length === Infinity) {
      note("This one can't skip");
      return;
    }
    video.currentTime = seekTime(video.currentTime, step, length);
    note(formatTime(video.currentTime) + ' / ' + formatTime(length));
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
    timer = setTimeout(open, delay);
  }

  function onMove(event) {
    pointer = { x: event.clientX, y: event.clientY };
    // At actual size, the mouse looks around the image instead.
    if (actualSize) {
      lookAround();
      return;
    }
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
  // Escape closes the popup, ← → move through a gallery, S saves, O opens in a new tab, C copies the image and
  // Shift+C the address, Z shows the actual size, R turns the image, F flips it, I shows details, ? lists the keys,
  // and for a video M turns the sound on or off, Space pauses and ← → go back or on, without the keys also reaching
  // the page, which might close a dialog, move a carousel, scroll or have shortcuts of its own. The key pressed
  // lights up where the keys show.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!hovered) return;
      if (event.key === 'Escape') {
        if (shown) event.stopPropagation();
        dismiss();
        return;
      }
      if (!shown || event.altKey || event.ctrlKey || event.metaKey || isTyping()) return;
      const video = isVideo(full) ? full : null;
      const arrow = { ArrowRight: 1, ArrowLeft: -1 }[event.key] || 0;
      // ← → move through a gallery, and in a video on its own, back or on.
      const step = gallery ? arrow : 0;
      const seek = video && !gallery ? arrow * SEEK_STEP : 0;
      const actions = { s: save, o: openInTab, z: toggleActualSize, r: turn, f: flip, i: toggleInfo, '?': toggleKeys };
      // A video can't go on the clipboard, so C is left to the page there.
      if (event.shiftKey) actions.c = copyAddress;
      else if (!video) actions.c = copyImage;
      if (video) Object.assign(actions, { m: () => toggleSound(video), ' ': () => togglePause(video) });
      const key = event.key.toLowerCase();
      const action = actions[key];
      if (!step && !seek && !action) return;
      event.preventDefault();
      event.stopPropagation();
      flashKey(arrow ? '← →' : key === ' ' ? 'Space' : event.shiftKey && key === 'c' ? 'Shift C' : event.key.toUpperCase());
      if (step) go(step);
      else if (seek) seekBy(video, seek);
      else if (!event.repeat) action();
    },
    true
  );

  // ---- Settings ----

  // Whether this site is one to leave alone, how long to wait, which way the wheel goes and whether keys show under
  // the popup, from the background script. With no answer, as when it isn't up yet, Largitude works with the
  // defaults rather than stay off for good.
  async function loadSettings(changed) {
    let settings = null;
    try {
      settings = await browser.runtime.sendMessage({ type: 'settings', changed });
    } catch (err) {
      settings = null;
    }
    enabled = !(settings && settings.excluded);
    delay = (settings && settings.delay) || DELAY;
    reverseWheel = !!(settings && settings.reverseWheel);
    keysUnder = !(settings && settings.keysUnder === false);
    if (!enabled) hide();
  }

  // A save is often two changes in a row (the sites taken off, then the rest), so the settings are asked for once
  // they've settled.
  let settingsTimer = 0;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(loadSettings, 50, true);
  });
  loadSettings(false);
})();
