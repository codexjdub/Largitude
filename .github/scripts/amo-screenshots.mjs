// Puts the screenshots amo/screenshots/screenshots.json lists on the add-on's page on Firefox Add-ons, in its order
// and with its captions, in place of the ones there. Firefox Add-ons allows few changes an hour, so it changes only
// what differs: a screenshot already there, which Firefox Add-ons keeps with the same pixels, stays; new ones go up
// before the old ones come down, so a failure leaves the page with screenshots. Needs AMO_JWT_ISSUER and
// AMO_JWT_SECRET in the environment.
//
//   node amo-screenshots.mjs [screenshots.json]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { amo, sleep } from './amo-api.mjs';

const list = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../../amo/screenshots/screenshots.json', import.meta.url);
const shots = JSON.parse(readFileSync(list, 'utf8'));
if (!shots.length) throw new Error('No screenshots listed.');

// Each a PNG, 1280×800 as Firefox Add-ons asks.
const files = shots.map(({ file, caption }) => {
  const bytes = readFileSync(new URL(file, list));
  const pixels = pixelsOf(bytes);
  if (!pixels || pixels.size !== '1280×800') throw new Error(`${file} isn't a 1280×800 PNG.`);
  if (!caption) throw new Error(`${file} has no caption.`);
  return { file, caption, bytes, pixels: pixels.hash };
});

const listed = async () => (await amo('')).previews.sort((a, b) => a.position - b.position || a.id - b.id);
const captionOf = (preview) => (preview.caption && preview.caption['en-US']) || '';

// Which file each screenshot there shows, if any.
const before = await listed();
const kept = new Map();
for (const preview of before) {
  const response = await fetch(preview.image_url);
  const pixels = response.ok ? pixelsOf(Buffer.from(await response.arrayBuffer())) : null;
  const index = files.findIndex((file, i) => !kept.has(i) && pixels && file.pixels === pixels.hash);
  if (index >= 0) kept.set(index, preview);
}

// The ones not there go up, each at its place.
const ids = [];
const added = [];
for (const [position, { file, bytes }] of files.entries()) {
  if (kept.has(position)) {
    ids.push(kept.get(position).id);
    console.log(`${file} is there already (${kept.get(position).id})`);
    continue;
  }
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), file);
  form.append('position', String(position));
  const preview = await amo('previews/', { method: 'POST', body: form });
  ids.push(preview.id);
  added.push(preview.id);
  console.log(`Added ${file} (${preview.id})`);
}

// Firefox Add-ons makes each new one's sizes afterwards, and saving them can undo a caption given meanwhile, so the
// captions wait until each has its sizes.
for (let tries = 0; ; tries++) {
  const now = await listed();
  if (added.every((id) => now.some((preview) => preview.id === id && preview.image_size && preview.image_size.length))) break;
  if (tries === 60) throw new Error("Firefox Add-ons hasn't finished with the new screenshots.");
  await sleep(5);
}

// Captions and places, where they differ, checked again in case one doesn't hold.
for (let round = 0; ; round++) {
  const now = new Map((await listed()).map((preview) => [preview.id, preview]));
  const changes = files
    .map(({ caption }, position) => {
      const preview = now.get(ids[position]);
      const change = {};
      if (captionOf(preview) !== caption) change.caption = { 'en-US': caption };
      if (preview.position !== undefined && preview.position !== position) change.position = position;
      return [preview.id, change];
    })
    .filter(([, change]) => Object.keys(change).length);
  if (!changes.length) break;
  if (round === 3) throw new Error(`Captions or places that don't hold: ${JSON.stringify(changes)}`);
  for (const [id, change] of changes) {
    await amo(`previews/${id}/`, { method: 'PATCH', body: change });
    console.log(`Changed ${id}: ${JSON.stringify(change)}`);
  }
  await sleep(10);
}

// The old ones come down.
for (const preview of before) {
  if (ids.includes(preview.id)) continue;
  await amo(`previews/${preview.id}/`, { method: 'DELETE' });
  console.log(`Removed the old screenshot ${preview.id}`);
}

const now = await listed();
if (now.map((preview) => preview.id).join() !== ids.join()) throw new Error(`The page has other screenshots than these: ${JSON.stringify(now)}`);
console.log(`The page has ${now.length} screenshots:`);
for (const preview of now) console.log(`  ${preview.position}: ${captionOf(preview)} ${preview.image_url}`);

// A hash of a PNG's pixels and its size as "width×height", or null for one this doesn't read: only 8 bits a
// channel, not interlaced, not with a palette, which covers the screenshots and Firefox Add-ons' copies of them.
function pixelsOf(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let header = null;
  const data = [];
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') header = body;
    if (kind === 'IDAT') data.push(body);
    at += 12 + length;
  }
  if (!header) return null;
  const [width, height, depth, type, interlaced] = [header.readUInt32BE(0), header.readUInt32BE(4), header[8], header[9], header[12]];
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (depth !== 8 || !channels || interlaced) return null;
  // Each row starts with how it was filtered, which is undone to get the pixels themselves.
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? out[y * stride + x - channels] : 0;
      const up = y ? out[(y - 1) * stride + x] : 0;
      const upLeft = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      const guess = left + up - upLeft;
      const [toLeft, toUp, toUpLeft] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)];
      const paeth = toLeft <= toUp && toLeft <= toUpLeft ? left : toUp <= toUpLeft ? up : upLeft;
      out[y * stride + x] = (raw[row + x] + [0, left, up, (left + up) >> 1, paeth][filter]) & 255;
    }
  }
  return { size: `${width}×${height}`, hash: createHash('sha256').update(`${width}×${height}×${channels}:`).update(out).digest('hex') };
}
