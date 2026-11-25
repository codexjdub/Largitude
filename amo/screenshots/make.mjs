// Takes the screenshots for the add-on's page on Firefox Add-ons: Largitude's content scripts on made-up pages
// (scenes.html, with the pictures from art.mjs) and the settings page, in Chrome without a window, driven through
// its DevTools protocol with real mouse moves and key presses. Writes the PNGs listed in screenshots.json next to
// this file, 1280×800 each.
//
//   node amo/screenshots/make.mjs        (CHROME=<path> to use another Chrome or Chromium)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pictures } from './art.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The page, Largitude's files, and the pictures, drawn on request.
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const send = (type, body) => res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(body);
  if (path === '/art/') return send(types['.json'], JSON.stringify(Object.entries(pictures).map(([name, { title }]) => ({ name, title }))));
  const picture = /^\/art\/([\w-]+)\.svg$/.exec(path);
  if (picture && pictures[picture[1]]) return send(types['.svg'], pictures[picture[1]].svg);
  if (/^\/(extension|amo\/screenshots)\/[\w-]+(\/[\w-]+)*\.\w+$/.test(path)) {
    try {
      return send(types[extname(path)] || 'application/octet-stream', await readFile(join(root, path)));
    } catch (err) {
      // Not there: a 404.
    }
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

// A connection to one tab: send(method, params) answers with the result; once(event) waits for an event.
async function connect(address) {
  const socket = new WebSocket(address);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error("Couldn't reach Chrome"));
  });
  let last = 0;
  const waiting = new Map();
  const listeners = new Set();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const call = waiting.get(message.id);
    if (call) {
      waiting.delete(message.id);
      if (message.error) call.reject(new Error(`${call.method}: ${message.error.message}`));
      else call.resolve(message.result);
    } else {
      listeners.forEach((listener) => listener(message));
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++last;
      waiting.set(id, { method, resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const once = (event) =>
    new Promise((resolve) => {
      const listener = (message) => {
        if (message.method !== event) return;
        listeners.delete(listener);
        resolve(message.params);
      };
      listeners.add(listener);
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception ? exceptionDetails.exception.description : exceptionDetails.text);
    return result.value;
  };
  return { send, once, evaluate };
}

// Opens `path` at `width`×`height`, drawn `scale` times as fine, so the picture is 1280×800, and waits for `ready`.
async function open(page, path, { width = 1280, height = 800, scale = 1, ready = 'window.ready' } = {}) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', { url: origin + path });
  await loaded;
  await until(page, ready, `${path} to be ready`);
}

async function until(page, expression, what, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await page.evaluate(expression))) {
    if (Date.now() > end) throw new Error('Gave up waiting for ' + what);
    await sleep(50);
  }
}

// Moves the mouse onto `selector`, `across` and `down` its width and height from its top left corner, and rests it
// there. The popup goes beside the mouse where it was when it started to rest.
async function hover(page, selector, { x: across = 0.5, y: down = 0.5 } = {}) {
  const box = await page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
  const x = Math.round(box[0] + box[2] * across);
  const y = Math.round(box[1] + box[3] * down);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  await sleep(50);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  return { x, y };
}

// Waits for the popup to show its image, faded in, and draws the mouse at `mouse`.
async function popupShown(page, mouse) {
  const shown = `(() => {
    const host = document.querySelector('largitude-popup');
    if (!host || host.style.display === 'none' || host.style.opacity !== '1') return false;
    const media = [...host.shadowRoot.firstElementChild.children].filter((el) => el.localName === 'img');
    const full = media[media.length - 1];
    return media.length > 1 && full.style.display !== 'none' && full.complete && full.naturalWidth > 0;
  })()`;
  await until(page, shown, 'the popup');
  await sleep(400);
  await page.evaluate(`(() => {
    const mouse = document.getElementById('mouse');
    mouse.style.left = '${mouse.x - 2}px';
    mouse.style.top = '${mouse.y - 2}px';
    mouse.showPopover();
  })()`);
}

async function press(page, key, code, keyCode, text = '', modifiers = 0) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: keyCode, text, modifiers });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
}

async function capture(page) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  return Buffer.from(data, 'base64');
}

// Each screenshot, by its file's name.
const scenes = {
  // A photo journal's thumbnail, and the picture at full size beside it, with the line of keys under it.
  async '1-popup.png'(page) {
    await open(page, '/amo/screenshots/scenes.html?photos');
    const mouse = await hover(page, '.grid figure:nth-child(4) img', { x: 0.55, y: 0.5 });
    await popupShown(page, mouse);
    return capture(page);
  },
  // A post with four photos: → from the first shows the second, "2 / 4", with a dot for each.
  async '2-gallery.png'(page) {
    await open(page, '/amo/screenshots/scenes.html?post');
    const mouse = await hover(page, '.four a:nth-child(1) img', { x: 0.8, y: 0.45 });
    await popupShown(page, mouse);
    await press(page, 'ArrowRight', 'ArrowRight', 39);
    await until(page, `document.querySelector('largitude-popup').shadowRoot.textContent.includes('2 / 4')`, 'the second photo');
    await popupShown(page, mouse);
    return capture(page);
  },
  // ? shows every key over the popup.
  async '3-keys.png'(page) {
    await open(page, '/amo/screenshots/scenes.html?photos');
    const mouse = await hover(page, '.grid figure:nth-child(3) img', { x: 0.5, y: 0.5 });
    await popupShown(page, mouse);
    await press(page, '?', 'Slash', 191, '?', 8);
    await sleep(300);
    return capture(page);
  },
  // The settings page, a moment after a change, which it saved at once.
  async '4-settings.png'(page) {
    const stored = {
      options: { hoverDelay: 'normal', keysUnderPopup: true, galleryWheelReversed: false },
      'site:mail.example.com': 0,
      'site:maps.example.org': 1,
    };
    const { identifier } = await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const items = ${JSON.stringify(stored)};
        window.browser = { storage: {
          sync: {
            async get() { return structuredClone(items); },
            async set(values) { Object.assign(items, structuredClone(values)); },
            async remove(names) { [].concat(names).forEach((name) => delete items[name]); },
          },
          local: { async get() { return {}; }, async remove() {} },
          onChanged: { addListener() {} },
        } };
      })();`,
    });
    await open(page, '/amo/screenshots/scenes.html?settings', { width: 960, height: 600, scale: 4 / 3 });
    await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const settings = "document.querySelector('iframe').contentDocument";
    await page.evaluate(`(() => {
      const select = ${settings}.getElementById('hoverDelay');
      select.value = 'short';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until(page, `${settings}.getElementById('status').textContent === 'Saved.'`, 'the settings to save');
    return capture(page);
  },
};

// Chrome, headless, with a profile of its own that's thrown away afterwards.
const chrome =
  process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const profile = mkdtempSync(join(tmpdir(), 'largitude-screenshots-'));
const browser = spawn(
  chrome,
  ['--headless', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
const finish = async () => {
  server.close();
  if (browser.exitCode === null && browser.signalCode === null) {
    const gone = new Promise((resolve) => browser.once('exit', resolve));
    browser.kill();
    await gone;
  }
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
};

try {
  const port = await new Promise((resolve, reject) => {
    let output = '';
    browser.stderr.on('data', (chunk) => {
      output += chunk;
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(output);
      if (match) resolve(match[1]);
    });
    browser.on('exit', () => reject(new Error('Chrome stopped: ' + output)));
    browser.on('error', reject);
  });
  const tabs = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = await connect(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: 'light' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  });

  const shots = JSON.parse(await readFile(join(here, 'screenshots.json'), 'utf8'));
  for (const { file } of shots) {
    if (!scenes[file]) throw new Error('No scene for ' + file);
    const png = await scenes[file](page);
    writeFileSync(join(here, file), png);
    console.log('Wrote ' + file);
  }
} finally {
  await finish();
}
