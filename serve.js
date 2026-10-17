// Portable static preview server for the built dashboard.
//
//   node serve.js                 # serves apps/web/dist on :3000
//   PORT=4173 node serve.js       # custom port
//   DIR=apps/web/dist node serve.js
//
// Zero dependencies. Serves the SPA with a correct MIME table (incl. .wasm)
// and an index.html fallback for deep links.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(root, process.env.DIR ?? 'apps/web/dist');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    let fp = path.join(dir, urlPath);
    // Prevent path traversal outside the served directory.
    if (!fp.startsWith(dir)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let data;
    try {
      data = await fs.readFile(fp);
    } catch {
      // SPA fallback: unknown non-asset paths render the app shell.
      if (!path.extname(urlPath)) {
        data = await fs.readFile(path.join(dir, 'index.html'));
        fp = path.join(dir, 'index.html');
      } else {
        res.writeHead(404).end(`Not found: ${urlPath}`);
        return;
      }
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] ?? 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(port, host, () => {
  console.log(`Tree of Life preview  ->  http://localhost:${port}`);
  console.log(`  serving ${dir}`);
});
