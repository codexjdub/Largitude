// Firefox Add-ons' API, signed in as the add-on's author with AMO_JWT_ISSUER and AMO_JWT_SECRET from the
// environment.
import { createHmac, randomUUID } from 'node:crypto';

export const ADDON = 'largitude@codexjdub.github.io';
export const ADDON_API = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON)}/`;

const issuer = process.env.AMO_JWT_ISSUER;
const secret = process.env.AMO_JWT_SECRET;
if (!issuer || !secret) throw new Error('Add the AMO_JWT_ISSUER and AMO_JWT_SECRET repository secrets first.');

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
// with the JSON answer, or null when there's none.
export async function amo(address, { method = 'GET', body } = {}) {
  const headers = { Authorization: 'JWT ' + token() };
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(address, ADDON_API), {
    method,
    headers,
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  const answer = await response.text();
  if (!response.ok) throw new Error(`Firefox Add-ons answered ${method} ${address} with ${response.status}: ${answer}`);
  return answer ? JSON.parse(answer) : null;
}
