// Updates the add-on's listing on Firefox Add-ons with amo/listing.json: the fields that stay the same from one
// version to the next, such as the website. The description goes with each release instead (amo-metadata.mjs),
// since it describes that version. Needs AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment.
//
//   node amo-listing.mjs [listing.json]
import { readFileSync } from 'node:fs';
import { amo } from './amo-api.mjs';

const listing = JSON.parse(readFileSync(process.argv[2] || new URL('../../amo/listing.json', import.meta.url), 'utf8'));
const addon = await amo('', { method: 'PATCH', body: listing });
for (const field of Object.keys(listing)) console.log(`${field}: ${JSON.stringify(addon[field])}`);
