// "Run checks" on the test page: hovers each card with synthetic mouse events, which Largitude's content script
// receives like real ones, and lists what the popup showed. The results also go to window.largitudeChecks.
(() => {
  const DELAY = 300; // Largitude's hover delay, in content.js
  const WHEEL_SETTLE = 150; // its pause that ends a wheel gesture
  // The wheel turned for the next image: fingers down, which on a Mac with natural scrolling scrolls the page up.
  const NEXT = /^Mac/.test(navigator.platform) ? -120 : 120;
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

  // What Largitude shows in a document: whether the popup is open, the file name of the full image in it, the
  // gallery counter ("2 / 3") and where it is. The thumbnail standing in for the full image comes first in the
  // popup, the full image last.
  function popupIn(doc) {
    const host = doc.querySelector('largitude-popup');
    if (!host || host.style.display === 'none' || !host.matches(':popover-open')) return { open: false };
    const children = [...host.shadowRoot.children];
    const images = children.filter((el) => el.localName === 'img');
    const full = images.length > 1 ? images[images.length - 1] : null;
    const src = full && full.style.display !== 'none' ? full.src.split('/').pop() : '';
    const counter = children.find((el) => el.style.display !== 'none' && /^\d+ \/ \d+$/.test(el.textContent));
    return { open: true, src, counter: counter ? counter.textContent : '', box: host.getBoundingClientRect() };
  }

  function moveTo(doc, x, y) {
    const view = doc.defaultView;
    const target = doc.elementFromPoint(x, y) || doc.documentElement;
    target.dispatchEvent(new view.MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true, composed: true, view }));
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
      report(moved, `${name}: fingers down move on to ${label(i)} without scrolling the page`, why);
    }
    await wait(WHEEL_SETTLE + 100);
    report(!wheel(NEXT) && showing(last), `${name}: past the last image, the wheel is left to the page`, describe());
    await wait(WHEEL_SETTLE + 100);
    wheel(-NEXT);
    report(await until(() => showing(last - 1), 2000), `${name}: fingers up move back to ${label(last - 1)}`, describe());
    await away(document);
  }

  // S saves the image shown. Only with ?standalone, where nothing can be saved, so a run with the extension
  // doesn't fill the Downloads folder: the key must not reach the page, and the popup says it couldn't save.
  async function checkSaveKey() {
    const el = document.querySelector('.case .target');
    await away(document);
    await hover(document, el);
    await until(() => popupIn(document).open, 3000);
    let reached = false;
    const listener = () => (reached = true);
    document.addEventListener('keydown', listener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', listener);
    const noted = await until(() => {
      const host = document.querySelector('largitude-popup');
      return host && [...host.shadowRoot.children].some((node) => node.style.display !== 'none' && /save/i.test(node.textContent));
    }, 1000);
    report(!reached && noted, 'S saves, without reaching the page, and the popup says how it went', reached ? 'the page got the key' : 'no note showed');
    await away(document);
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

    point = await hover(document, el);
    await until(isOpen, 3000);
    await away(document);
    report(!isOpen(), 'moving off the image closes it');
  }

  async function run() {
    const button = document.getElementById('run');
    button.disabled = true;
    results.replaceChildren();
    lines.length = 0;
    window.largitudeChecks = { done: false, lines };
    for (const card of document.querySelectorAll('.case')) await checkCard(card);
    await checkBehavior();
    if (standalone) await checkSaveKey();
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
