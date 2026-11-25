// Firefox Add-ons' API, signed in as the add-on's author with AMO_JWT_ISSUER and AMO_JWT_SECRET from the
// environment.
import { createHmac, randomUUID } from 'node:crypto';

export const ADDON = 'largitude@codexjdub.github.io';
export const ADDON_API = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON)}/`;

const issuer = process.env.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET;
if (!issuer || !secret) throw new Error('Add the AMO_JWT_ISSUER and AMO_JWT_SECRET repository secrets first.');

// Firefox Add-ons lets an author make 3 changes a minute, 10 an hour and 24 a day, releases included, and says how
// long to wait once there have been too many. Waits longer than this give up instead.
const LONGEST_WAIT = 70 * 60;

export const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

// The API's sign-in: a JSON Web Token signed with the secret, good for a minute, a new one for each request.
function token() {
  const base64url = (text) => Buffer.from(text).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
    '.' +
    base64url(JSON.stringify({ iss: issuer, jti: randomUUID(), iat: now, exp: now + 60 }));
  return unsigned + '.' + createHmac('sha256', secret).update(unsigned).digest('base64url');
}

// Sends `body` to `address` (under the add-on's, if relative): JSON for an object, as it is for FormData. Answers
// with the JSON answer, or null when there's none. Turned away for too many changes, it waits as long as it's told
// to and sends it again.
export async function amo(address, { method = 'GET', body } = {}) {
  const form = body instanceof FormData;
  for (;;) {
    const headers = { Authorization: 'JWT ' + token() };
    if (body && !form) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(address, ADDON_API), { method, headers, body: body && !form ? JSON.stringify(body) : body });
    const answer = await response.text();
    if (response.status === 429) {
      const said = /available in (\d+) second/.exec(answer);
      const wait = Number(response.headers.get('retry-after')) || (said && Number(said[1]));
      if (wait && wait <= LONGEST_WAIT) {
        console.log(`Firefox Add-ons wants fewer changes at a time: waiting ${wait} seconds`);
        await sleep(wait + 2);
        continue;
      }
    }
    if (!response.ok) throw new Error(`Firefox Add-ons answered ${method} ${address} with ${response.status}: ${answer}`);
    return answer ? JSON.parse(answer) : null;
  }
}
