// "Run checks" on the test page: hovers each card with synthetic mouse events, which Largitude's content script
// receives like real ones, and lists what the popup showed. The results also go to window.largitudeChecks.
(() => {
  const DELAY = 300; // Largitude's hover delay, in content.js
  const WHEEL_SETTLE = 150; // its pause that ends a wheel gesture
  // The wheel turned for the next image: the way that scrolls the page down.
  const NEXT = 120;
  const REVERSED = 'if "Reverse the mouse wheel in galleries" is on in Largitude\'s settings, turn it off for the checks';
  const standalone = new URLSearchParams(location.search).has('standalone');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const results = document.getElementById('results');
  const lines = [];

  async function until(test, ms) {
    for (const end = Date.now() + ms; ; await wait(25)) {
      const value = test();
      if (value || Date.now() > end) return value;
    }
  }

  function report(ok, name, detail) {
    lines.push({ ok, name, detail });
    const line = document.createElement('div');
    line.className = ok ? 'pass' : 'fail';
    line.textContent = (ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail ? ' — ' + detail : '');
    results.append(line);
    results.scrollTop = results.scrollHeight;
  }

  // What Largitude shows in a document: whether the popup is open, the file name of the full image or video in
  // it, the gallery counter ("2 / 3"), any note ("Saved"), where it is, the video, the line of keys under it and
  // the panel of keys ? opens. The popup's box comes first in its shadow root, then the line and the panel; in the
  // box, the thumbnail standing in for the full image comes first, the full image or video last.
  function popupIn(doc) {
    const host = doc.querySelector('largitude-popup');
    if (!host || host.style.display === 'none' || !host.matches(':popover-open')) return { open: false };
    const [stage, hint, keys] = host.shadowRoot.children;
    const children = [...stage.children];
    const media = children.filter((el) => el.localName === 'img' || el.localName === 'video');
    const full = media.length > 1 ? media[media.length - 1] : null;
    const src = full && full.style.display !== 'none' ? full.src.split('/').pop() : '';
    const shown = (test) => children.find((el) => el.style.display !== 'none' && test(el.textContent));
    const counter = shown((text) => /^\d+ \/ \d+$/.test(text));
    const note = shown((text) => /[a-z]/i.test(text));
    return {
      open: true,
      src,
      counter: counter ? counter.textContent : '',
      note: note ? note.textContent : '',
      box: host.getBoundingClientRect(),
      full,
      video: full && full.localName === 'video' ? full : null,
      hint: hint.style.display !== 'none' ? hint.textContent : '',
      hintBox: hint.getBoundingClientRect(),
      keys: keys.style.display !== 'none' ? keys : null,
    };
  }

  function moveTo(doc, x, y, keys = {}) {
    const view = doc.defaultView;
    const target = doc.elementFromPoint(x, y) || doc.documentElement;
    target.dispatchEvent(new view.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, composed: true, view, ...keys }));
    return { x, y };
  }

  async function hover(doc, el) {
    el.scrollIntoView({ block: 'center' });
    await wait(100); // the scroll closes any popup first
    const rect = el.getBoundingClientRect();
    return moveTo(doc, Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
  }

  // The top left corner is page margin: nothing to show there.
  async function away(doc) {
    moveTo(doc, 2, 2);
    await until(() => !popupIn(doc).open, 1000);
  }

  // The popup is inside the window and, unless it covers the window, beside the pointer rather than on it.
  function placement(doc, box, point) {
    const view = doc.documentElement;
    if (box.left < 0 || box.top < 0 || box.right > view.clientWidth + 1 || box.bottom > view.clientHeight + 1) {
      return 'it goes past the window';
    }
    const covers = point.x >= box.left && point.x < box.right && point.y >= box.top && point.y < box.bottom;
    const whole = box.width >= view.clientWidth * 0.6 || box.height >= view.clientHeight * 0.6;
    return covers && !whole ? 'it covers the pointer' : '';
  }

  // A gallery card: the hovered image opens with its counter, ← goes back to the first, → and the wheel go on to
  // the last, and past the last the wheel is left to the page. The page gets neither the keys nor the wheel.
  async function checkGallery(card) {
    const name = card.querySelector('h2').textContent;
    const files = card.dataset.gallery.split(' ');
    const last = files.length - 1;
    const el = card.querySelector('.target');
    const label = (i) => `${files[i]} as ${i + 1} / ${files.length}`;
    const showing = (i) => {
      const popup = popupIn(document);
      return popup.open && popup.src === files[i] && popup.counter === `${i + 1} / ${files.length}`;
    };
    const describe = () => {
      const popup = popupIn(document);
      return popup.open ? `it showed ${popup.src || 'no image yet'} as ${popup.counter || 'no counter'}` : 'nothing showed';
    };
    // Each returns whether Largitude kept the event from the page.
    const key = (name) => !document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    const wheel = (deltaY) =>
      !el.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true, clientX: point.x, clientY: point.y }));

    await away(document);
    const point = await hover(document, el);
    let at = Number(card.dataset.start) - 1;
    const opened = await until(() => showing(at), 3000);
    report(opened, `${name}: shows ${label(at)}`, describe());
    if (!opened) {
      await away(document);
      return;
    }
    let keysKept = true;
    while (at > 0) {
      keysKept = key('ArrowLeft') && keysKept;
      at -= 1;
      if (!(await until(() => showing(at), 2000))) break;
    }
    report(showing(0), `${name}: ← moves back to ${label(0)}`, describe());
    keysKept = key('ArrowRight') && keysKept;
    report(await until(() => showing(1), 2000), `${name}: → moves on to ${label(1)}`, describe());
    report(keysKept, `${name}: the page doesn't get the arrow keys`);
    for (let i = 2; i <= last; i++) {
      await wait(WHEEL_SETTLE + 100);
      const kept = wheel(NEXT);
      const moved = kept && (await until(() => showing(i), 2000));
      const why = kept ? describe() : `the page got the wheel (${REVERSED})`;
      report(moved, `${name}: scrolling down moves on to ${label(i)} without scrolling the page`, why);
    }
    await wait(WHEEL_SETTLE + 100);
    report(!wheel(NEXT) && showing(last), `${name}: past the last image, the wheel is left to the page`, describe());
    await wait(WHEEL_SETTLE + 100);
    wheel(-NEXT);
    report(await until(() => showing(last - 1), 2000), `${name}: scrolling up moves back to ${label(last - 1)}`, describe());
    await away(document);
  }

  // Whether a key pressed with the popup open reaches the page.
  function pressReaches(key) {
    let reached = false;
    const listener = () => (reached = true);
    document.addEventListener('keydown', listener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', listener);
    return reached;
  }

  // S saves the image shown. Only with ?standalone, where nothing can be saved, so a run with the extension
  // doesn't fill the Downloads folder: the key must not reach the page, and the popup says it couldn't save.
  async function checkSaveKey() {
    const el = document.querySelector('.case .target');
    await away(document);
    await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    const reached = pressReaches('s');
    const noted = await until(() => /save/i.test(popupIn(document).note || ''), 1000);
    report(!reached && noted, 'S saves, without reaching the page, and the popup says how it went', reached ? 'the page got the key' : 'no note showed');
    await away(document);
  }

  // O opens the image in a new tab and C copies its address. Only with ?standalone, like S: there's no
  // background script to open a tab, so the popup says it couldn't, and the clipboard is stood in for.
  async function checkOpenAndCopy() {
    const el = document.querySelector('.case .target');
    await away(document);
    await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    let reached = pressReaches('o');
    const said = await until(() => /open/i.test(popupIn(document).note || ''), 1000);
    report(!reached && said, 'O opens it in a new tab, without reaching the page', reached ? 'the page got the key' : 'no note showed');
    let copied = '';
    navigator.clipboard.writeText = async (text) => {
      copied = text;
    };
    reached = pressReaches('c');
    const noted = await until(() => /copied/i.test(popupIn(document).note || ''), 1000);
    delete navigator.clipboard.writeText;
    const why = reached ? 'the page got the key' : `copied "${copied}", note "${popupIn(document).note}"`;
    report(!reached && noted && /full-1600x1200\.svg$/.test(copied), 'C copies the full-size address, without reaching the page', why);
    await away(document);
  }

  // Z shows the image at its actual size, filling the window, and the mouse looks around it; Z again goes back.
  async function checkActualSize() {
    const el = document.querySelector('.case .target');
    await away(document);
    const point = await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    const fitted = popupIn(document).box;
    const view = document.documentElement;
    const reached = pressReaches('z');
    let popup = popupIn(document);
    const filled = popup.open && popup.box.left === 0 && popup.box.top === 0 && popup.box.width === view.clientWidth;
    const actual = !!popup.full && popup.full.style.width === '1600px' && popup.full.style.height === '1200px';
    report(!reached && filled && actual, 'Z shows the image at its actual size, filling the window', `box ${JSON.stringify(popup.box)}, image ${popup.full && popup.full.style.width}`);
    moveTo(document, 0, 0);
    const left = popup.full.style.left;
    moveTo(document, view.clientWidth - 1, view.clientHeight - 1);
    const right = popup.full.style.left;
    popup = popupIn(document);
    report(popup.open && left === '0px' && parseFloat(right) < -500, 'at actual size, moving the mouse looks around the image', `left ${left} then ${right}, open ${popup.open}`);
    moveTo(document, point.x, point.y);
    pressReaches('z');
    popup = popupIn(document);
    const back = popup.open && Math.round(popup.box.left) === Math.round(fitted.left) && Math.round(popup.box.width) === Math.round(fitted.width);
    report(back, 'Z again goes back to the fitted popup', `box ${JSON.stringify(popup.box)}`);
    await away(document);
  }

  // R turns the image a quarter turn and the popup turns in place, about its middle; four turns bring it back. At
  // actual size the mouse looks around the turned image, and Z goes back to the popup turned in place.
  async function checkTurn() {
    const el = document.querySelector('.case .target');
    await away(document);
    const point = await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    const view = document.documentElement;
    const tall = (box) => Math.abs(box.height / box.width - 4 / 3) < 0.02;
    const upright = popupIn(document).box;
    const middle = (box) => [box.left + box.width / 2, box.top + box.height / 2];
    // The same middle, unless it had to move to stay inside the window, with room for the line of keys below.
    const sameMiddle = (box) => {
      const [x, y] = middle(box);
      const across = Math.abs(x - middle(upright)[0]) <= 1 || box.left === 8 || box.right === view.clientWidth - 8;
      const down = Math.abs(y - middle(upright)[1]) <= 1 || box.top === 8 || box.bottom === view.clientHeight - 40;
      return across && down;
    };
    const same = (box) => ['left', 'top', 'width', 'height'].every((side) => Math.abs(box[side] - upright[side]) < 1);
    const reached = pressReaches('r');
    let popup = popupIn(document);
    let seen = popup.full ? popup.full.getBoundingClientRect() : null;
    const covered = !!seen && Math.abs(seen.width - popup.box.width) < 1 && Math.abs(seen.height - popup.box.height) < 1;
    report(!reached && popup.open && tall(popup.box) && sameMiddle(popup.box) && covered, 'R turns the image a quarter turn, the popup turning in place, without reaching the page', `box ${JSON.stringify(popup.box)} from ${JSON.stringify(upright)}, image ${JSON.stringify(seen)}`);
    ['r', 'r', 'r'].forEach(pressReaches);
    popup = popupIn(document);
    report(popup.open && same(popup.box) && popup.full.style.transform === 'none', 'four turns bring it back upright, where it was', `box ${JSON.stringify(popup.box)}, ${popup.full && popup.full.style.transform}`);
    pressReaches('r');
    pressReaches('z');
    moveTo(document, 0, 0);
    const corner = popupIn(document).full.getBoundingClientRect();
    moveTo(document, view.clientWidth - 1, view.clientHeight - 1);
    seen = popupIn(document).full.getBoundingClientRect();
    const around = Math.round(corner.left) === 0 && Math.round(corner.top) === 0 && Math.round(seen.right) === view.clientWidth;
    report(around && Math.round(seen.width) === 1200 && Math.round(seen.height) === 1600, 'at actual size, the mouse looks around the turned image', `at the top left ${JSON.stringify(corner)}, at the bottom right ${JSON.stringify(seen)}`);
    moveTo(document, point.x, point.y);
    pressReaches('r');
    pressReaches('z');
    popup = popupIn(document);
    report(popup.open && same(popup.box), 'turned again at actual size, Z goes back to the popup turned in place: a half turn, where it was', `box ${JSON.stringify(popup.box)} from ${JSON.stringify(upright)}`);
    await away(document);
  }

  // A key typed in a web component's text box goes to the box, even with a gallery's popup open: the page sees the
  // key as coming from the component, so Largitude has to look for the focus inside it.
  async function checkTypingInComponent() {
    const card = document.querySelector('.case[data-gallery]');
    const box = document.querySelector('text-host').shadowRoot.querySelector('textarea');
    await away(document);
    await hover(document, card.querySelector('.target'));
    const before = await until(() => popupIn(document).counter, 3000);
    box.focus({ preventScroll: true });
    let reached = false;
    const listener = () => (reached = true);
    box.addEventListener('keydown', listener);
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true, cancelable: true });
    box.dispatchEvent(event);
    box.removeEventListener('keydown', listener);
    const after = popupIn(document).counter;
    box.blur();
    const kept = reached && !event.defaultPrevented && after === before;
    const why = !before ? 'no gallery showed' : `the box got the key ${reached}, kept from it ${event.defaultPrevented}, gallery at ${after}`;
    report(!!before && kept, 'a key typed in a web component\'s text box goes to the box, not the popup', why);
    await away(document);
  }

  // A video plays muted and looping, M and Space work on it without reaching the page, and closing the popup
  // stops it loading.
  async function checkVideo(card) {
    const name = card.querySelector('h2').textContent;
    await away(document);
    await hover(document, card.querySelector('.target'));
    const video = await until(() => popupIn(document).video, 3000);
    if (!video) {
      report(false, name + ': plays a video', 'no video showed');
      await away(document);
      return;
    }
    // A video playing on the page goes on in the popup from where it is, whether the popup plays the same file
    // or, for a streamed one, a file of it.
    const target = card.querySelector('.target');
    const pageVideo = target.localName === 'video' ? target : target.shadowRoot && target.shadowRoot.querySelector('video');
    if (pageVideo) {
      const gap = Math.abs(video.currentTime - pageVideo.currentTime);
      const together = gap < 0.25 || Math.abs(gap - pageVideo.duration) < 0.25;
      const times = `page at ${pageVideo.currentTime.toFixed(2)} s, popup at ${video.currentTime.toFixed(2)} s`;
      report(together, name + ": the popup goes on from where the page's video is", times);
    }

    const start = video.currentTime;
    const moving = await until(() => !video.paused && video.currentTime !== start, 2000);
    report(moving && video.muted && video.loop, name + ': the video plays, muted and looping', `paused ${video.paused}, muted ${video.muted}, loop ${video.loop}`);

    const mReached = pressReaches('m');
    const sound = await until(() => /sound/i.test(popupIn(document).note || ''), 1000);
    report(!mReached && sound, name + ': M turns the sound on or off, or says there is none', mReached ? 'the page got the key' : 'no note showed');

    const spaceReached = pressReaches(' ');
    const paused = await until(() => video.paused, 1000);
    pressReaches(' ');
    const playing = await until(() => !video.paused, 1000);
    report(!spaceReached && paused && playing, name + ': Space pauses and plays again', spaceReached ? 'the page got the key' : `paused ${paused}, played again ${playing}`);

    await away(document);
    const stopped = video.paused && !video.getAttribute('src') && video.networkState === HTMLMediaElement.NETWORK_EMPTY;
    report(stopped, name + ': closing the popup stops the video loading', `paused ${video.paused}, src ${video.getAttribute('src')}, network state ${video.networkState}`);
  }

  async function checkCard(card) {
    if (card.dataset.gallery) return checkGallery(card);
    const name = card.querySelector('h2').textContent;
    const expect = (standalone && card.dataset.standaloneExpect) || card.dataset.expect;
    let doc = document;
    let el = card.querySelector('.target');
    const dialog = 'dialog' in card.dataset ? card.querySelector('dialog') : null;
    if (dialog) {
      dialog.showModal();
      el = dialog.querySelector('.target');
    }
    if ('frame' in card.dataset) {
      el.scrollIntoView({ block: 'center' });
      doc = el.contentDocument;
      if (!doc || !doc.querySelector('.target')) {
        report(false, name, "can't reach the frame: open this page through npm run serve");
        return;
      }
      el = doc.querySelector('.target');
    }
    await away(doc);
    const point = await hover(doc, el);
    if (expect === 'none') {
      await wait(DELAY + 700);
      const popup = popupIn(doc);
      report(!popup.open, name + ': shows nothing', 'it showed ' + (popup.src || 'a popup'));
    } else {
      const popup = await until(() => {
        const p = popupIn(doc);
        return p.open && p.src ? p : null;
      }, 3000);
      if (!popup) report(false, name + ': shows ' + expect, 'nothing showed');
      else if (popup.src !== expect) report(false, name + ': shows ' + expect, 'it showed ' + popup.src);
      else {
        const problem = placement(doc, popup.box, point);
        report(!problem, name + ': shows ' + expect + ', inside the window and beside the pointer', problem);
      }
    }
    await away(doc);
    if (dialog) dialog.close();
  }

  // Opening, closing and staying closed, on the first card.
  async function checkBehavior() {
    const el = document.querySelector('.case .target');
    const isOpen = () => popupIn(document).open;
    await away(document);
    let point = await hover(document, el);
    await wait(DELAY / 2);
    report(!isOpen(), 'waits for the pointer to rest before opening');
    report(!!(await until(isOpen, 3000)), 'opens once the pointer has rested');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    report(!!(await until(() => !isOpen(), 500)), 'Escape closes it');
    moveTo(document, point.x + 3, point.y + 3);
    await wait(DELAY + 500);
    report(!isOpen(), 'after Escape, it stays closed while the pointer stays on the image');
    await away(document);
    point = await hover(document, el);
    report(!!(await until(isOpen, 3000)), 'after Escape, moving off and back opens it again');

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: point.x, clientY: point.y, buttons: 1 }));
    report(!!(await until(() => !isOpen(), 500)), 'a click closes it');
    await away(document);

    point = await hover(document, el);
    await until(isOpen, 3000);
    results.scrollTop = results.scrollTop ? 0 : results.scrollHeight;
    await wait(150);
    report(isOpen(), 'another box on the page scrolling leaves it open');
    window.scrollBy(0, 1);
    report(!!(await until(() => !isOpen(), 500)), 'scrolling the page closes it');
    await away(document);

    await hover(document, el);
    await until(isOpen, 3000);
    await away(document);
    report(!isOpen(), 'moving off the image closes it');
  }

  // A line under the popup shows a few keys, and ? (typed with Shift) shows them all over it.
  async function checkKeys() {
    const el = document.querySelector('.case .target');
    await away(document);
    await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    let popup = popupIn(document);
    const under = popup.hintBox.top >= popup.box.bottom && popup.hintBox.bottom <= document.documentElement.clientHeight;
    report(/save/.test(popup.hint) && /all keys/.test(popup.hint) && under, 'a line under the popup shows a few keys, and ? for all of them', `"${popup.hint}", line ${JSON.stringify(popup.hintBox)}, popup ${JSON.stringify(popup.box)}`);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }));
    const reached = pressReaches('?');
    popup = popupIn(document);
    const listed = !!popup.keys && /Turn a quarter turn/.test(popup.keys.textContent);
    report(popup.open && !reached && listed, '? shows every key over the popup, without reaching the page', !popup.open ? 'Shift closed the popup' : reached ? 'the page got the key' : 'no keys showed');
    pressReaches('?');
    popup = popupIn(document);
    report(popup.open && !popup.keys, '? again hides them');
    await away(document);
  }

  // With "Show keys under the popup" off, there's no line of keys. Only with ?standalone, where the checks stand
  // in for the background script's settings.
  async function checkKeysSetting() {
    const el = document.querySelector('.case .target');
    const settle = async (settings) => {
      window.standaloneSettings = settings;
      browser.storage.onChanged.listeners.forEach((listener) => listener({ options: {} }, 'local'));
      await wait(50);
    };
    await away(document);
    await settle({ keysUnder: false });
    await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    const popup = popupIn(document);
    report(popup.open && !popup.hint, 'with "Show keys under the popup" off, no line of keys', `"${popup.hint}"`);
    await away(document);
    await settle(null);
  }

  async function run() {
    const button = document.getElementById('run');
    button.disabled = true;
    results.replaceChildren();
    lines.length = 0;
    window.largitudeChecks = { done: false, lines };
    for (const card of document.querySelectorAll('.case')) await checkCard(card);
    for (const card of document.querySelectorAll('.case[data-video]')) await checkVideo(card);
    await checkBehavior();
    await checkTypingInComponent();
    await checkActualSize();
    await checkTurn();
    await checkKeys();
    if (standalone) await checkKeysSetting();
    if (standalone) await checkSaveKey();
    if (standalone) await checkOpenAndCopy();
    const failed = lines.filter((line) => !line.ok).length;
    const summary = document.createElement('div');
    summary.className = failed ? 'fail' : 'pass';
    summary.textContent = failed ? `${failed} of ${lines.length} checks failed.` : `All ${lines.length} checks passed.`;
    if (failed && !document.querySelector('largitude-popup')) {
      summary.textContent += ' Largitude never showed a popup here: is the extension installed? (Or add ?standalone to the address.)';
    }
    results.append(summary);
    window.largitudeChecks = { done: true, failed, lines };
    button.disabled = false;
  }

  document.getElementById('run').addEventListener('click', run);
})();
