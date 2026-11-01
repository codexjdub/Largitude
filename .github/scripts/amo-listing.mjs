// Updates the add-on's listing on Firefox Add-ons with amo/listing.json: the fields that stay the same from one
// version to the next, such as the website. The description goes with each release instead (amo-metadata.mjs),
// since it describes that version. Needs AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment.
//
//   node amo-listing.mjs [listing.json]
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ADDON = 'largitude@codexjdub.github.io';
const issuer = process.env.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET;
if (!issuer || !secret) throw new Error('Add the AMO_JWT_ISSUER and AMO_JWT_SECRET repository secrets first.');

// The API's sign-in: a JSON Web Token signed with the secret, good for a minute.
const base64url = (text) => Buffer.from(text).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned =
  base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
  '.' +
  base64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 }));
const token = unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');

const listing = JSON.parse(readFileSync(process.argv[2] || new URL('../../amo/listing.json', import.meta.url), 'utf8'));
const response = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON)}/`, {
  method: 'PATCH',
  headers: { Authorization: 'JWT ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(listing),
});
const answer = await response.text();
if (!response.ok) throw new Error(`Firefox Add-ons answered ${response.status}: ${answer}`);
const addon = JSON.parse(answer);
for (const field of Object.keys(listing)) console.log(`${field}: ${JSON.stringify(addon[field])}`);
