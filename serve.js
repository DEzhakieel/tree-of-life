// Portable static preview server for the built dashboard.
//
//   node serve.js                 # serves apps/web/dist on :3000
//   PORT=4173 node serve.js       # custom port
//   DIR=apps/web/dist node serve.js
//
// Zero dependencies. Serves the SPA with a correct MIME table (incl. .wasm)
// and an index.html fallback for deep links.
//
// Builds made with a non-root base (e.g. `FLS_BASE=/tree-of-life/`, which is
// what GitHub Pages needs) reference their assets under that prefix. This
// server detects the prefix from the built index.html and serves it at the
// matching paths, so the same `dist` works both locally and under a sub-path.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(root, process.env.DIR ?? 'apps/web/dist');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

/** Read the deployment base out of the built shell ("/", "/tree-of-life/", ...). */
async function detectBase() {
  if (process.env.BASE) return process.env.BASE.endsWith('/') ? process.env.BASE : `${process.env.BASE}/`;
  try {
    const html = await fs.readFile(path.join(dir, 'index.html'), 'utf8');
    const m = html.match(/(?:src|href)="\/([^/"]+)\/assets\//);
    return m ? `/${m[1]}/` : '/';
  } catch {
    return '/';
  }
}

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

const base = await detectBase();

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    // Under a non-root base, the canonical entry is the base itself and asset
    // paths carry the prefix; strip it so disk paths stay relative to `dir`.
    let reqPath = urlPath;
    if (base !== '/') {
      if (urlPath === '/') {
        res.writeHead(302, { Location: base }).end();
        return;
      }
      if (urlPath.startsWith(base)) reqPath = urlPath.slice(base.length - 1);
    }
    let fp = path.join(dir, reqPath);
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
      if (!path.extname(reqPath)) {
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
  console.log(`Tree of Life preview  ->  http://localhost:${port}${base}`);
  console.log(`  serving ${dir} (base ${base})`);
});
