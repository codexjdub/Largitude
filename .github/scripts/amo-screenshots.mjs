// Replaces the screenshots on the add-on's page on Firefox Add-ons with the ones amo/screenshots/screenshots.json
// lists, in its order and with its captions. The new ones go up first, and the old ones come down only once they
// have, so a failure leaves the page with screenshots. Needs AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment.
//
//   node amo-screenshots.mjs [screenshots.json]
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { amo } from './amo-api.mjs';

const list = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../../amo/screenshots/screenshots.json', import.meta.url);
const shots = JSON.parse(readFileSync(list, 'utf8'));
if (!shots.length) throw new Error('No screenshots listed.');

// Each a PNG, 1280×800 as Firefox Add-ons asks, read from its header.
const files = shots.map(({ file, caption }) => {
  const bytes = readFileSync(new URL(file, list));
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const size = png ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] : [];
  if (size.join('×') !== '1280×800') throw new Error(`${file} isn't a 1280×800 PNG.`);
  if (!caption) throw new Error(`${file} has no caption.`);
  return { file, caption, bytes };
});

const old = (await amo('')).previews.map((preview) => preview.id);
for (const [position, { file, caption, bytes }] of files.entries()) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: 'image/png' }), file);
  form.append('position', String(position));
  const preview = await amo('previews/', { method: 'POST', body: form });
  // A caption is a field in each language, which a form can't carry, so it goes on afterwards.
  await amo(`previews/${preview.id}/`, { method: 'PATCH', body: { caption: { 'en-US': caption } } });
  console.log(`Added ${file} (${preview.id}): ${caption}`);
}
for (const id of old) {
  await amo(`previews/${id}/`, { method: 'DELETE' });
  console.log(`Removed the old screenshot ${id}`);
}
const now = (await amo('')).previews;
console.log(`The page has ${now.length} screenshots:`);
for (const preview of now) console.log(`  ${preview.position}: ${preview.image_url}`);
