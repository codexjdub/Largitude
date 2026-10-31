// Minimal static server for the test page: npm run serve, then open
// http://127.0.0.1:8766/test/test-page.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 8766;
const hostname = process.env.HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};
// Only the extension and the test files. The rest of the repo (.git, local notes, node_modules) stays private.
const isServed = (file) => /^(extension|test)[/\\]/.test(file) && !file.split(/[/\\]/).some((part) => part.startsWith('.'));

createServer(async (req, res) => {
  let path = '';
  try {
    path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  } catch (err) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
    return;
  }
  const file = path || 'test/test-page.html';
  try {
    if (!isServed(file)) throw new Error('not served');
    const body = await readFile(join(root, file));
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, hostname, () => console.log(`Serving on http://127.0.0.1:${port}/test/test-page.html`));
