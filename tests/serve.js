// Serves the built site (_site/) the way GitHub Pages does, for browser tests.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.env.SITE_DIR || new URL('../_site/', import.meta.url).pathname;
const port = Number(process.env.PORT) || 4173;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

async function resolve(pathname) {
  const path = join(root, normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, ''));
  for (const candidate of [path, join(path, 'index.html'), `${path}.html`]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {}
  }
  return null;
}

createServer(async (request, response) => {
  const file = await resolve(new URL(request.url, 'http://localhost').pathname);
  if (!file) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  response.end(await readFile(file));
}).listen(port, () => console.log(`Serving _site on http://localhost:${port}`));
