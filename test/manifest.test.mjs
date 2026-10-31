// Checks the manifest against extension/, which goes to Firefox Add-ons as it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const extension = new URL('../extension/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', extension), 'utf8'));

test('every file the manifest names is in extension/', () => {
  const files = [
    ...Object.values(manifest.icons),
    manifest.action.default_icon,
    manifest.options_ui.page,
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((script) => script.js),
  ];
  const missing = files.filter((file) => !existsSync(new URL(file, extension)));
  assert.deepEqual(missing, []);
});

// A file in sites/ that isn't listed would never run.
test('every site file is a content script, after helpers.js and before content.js', () => {
  const scripts = manifest.content_scripts[0].js;
  const sites = readdirSync(new URL('sites/', extension))
    .filter((file) => file.endsWith('.js'))
    .map((file) => 'sites/' + file);
  assert.equal(scripts[0], 'helpers.js');
  assert.equal(scripts[scripts.length - 1], 'content.js');
  assert.deepEqual(scripts.slice(1, -1).sort(), sites.sort());
});

// The release workflow compares it with the release's tag, v<version>.
test('the version is x.y.z', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});
