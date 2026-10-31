// Writes the metadata the Firefox Add-ons workflow sends with each version: the release's "What's new" as
// release notes (plain text, since Firefox Add-ons doesn't render Markdown), amo/reviewer-notes.txt
// for Mozilla's reviewers, and amo/description.txt as the listing's description, when there is one. Reads
// the release body from RELEASE_NOTES.
//
//   node amo-metadata.mjs <output.json> [reviewer-notes.txt] [description.txt]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const body = (process.env.RELEASE_NOTES || '').replace(/\r/g, '');
const notes = body
  .split(/\n## Updating/)[0]
  .replace(/^## [^\n]*\n+/, '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
  .replace(/^- /gm, '• ')
  .trim();
if (!notes) throw new Error('The release has no "What\'s new" notes.');
const approval = readFileSync(process.argv[3] || new URL('../../amo/reviewer-notes.txt', import.meta.url), 'utf8');
const metadata = { version: { release_notes: { 'en-US': notes }, approval_notes: approval } };
const descriptionFile = process.argv[4] || new URL('../../amo/description.txt', import.meta.url);
if (existsSync(descriptionFile)) metadata.description = { 'en-US': readFileSync(descriptionFile, 'utf8').trim() };
writeFileSync(process.argv[2], JSON.stringify(metadata, null, 2) + '\n');
console.log('Release notes for Firefox Add-ons:\n\n' + notes);
console.log(metadata.description ? '\nThe listing\'s description is sent too.' : '\nNo description to send.');
