import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { FEEDS_FILE, loadEntries } from './feeds.js';

// Local development server. The deployed site is static: build.js writes the same
// data to public/entries.json, which this server generates on the fly instead.
const PUBLIC = join(import.meta.dirname, 'public');
const PORT = Number(process.env.PORT ?? 4173);
const REFRESH_MS = 15 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const feedsMtime = () => stat(FEEDS_FILE).then((s) => s.mtimeMs, () => 0);

let state = { updatedAt: null, entries: [], feeds: [] };
let loadedMtime = -1;
let refreshing = null;

async function refresh() {
  const mtime = await feedsMtime();
  state = await loadEntries();
  loadedMtime = mtime;
}

// Refreshes when the cache is stale or feeds.txt was edited; concurrent callers share one run.
async function ensureFresh() {
  const stale = !state.updatedAt || Date.now() - Date.parse(state.updatedAt) > REFRESH_MS;
  if (!stale && (await feedsMtime()) === loadedMtime) return;
  refreshing ??= refresh().finally(() => (refreshing = null));
  await refreshing;
}

async function serveStatic(pathname, res) {
  const file = normalize(join(PUBLIC, pathname === '/' ? 'index.html' : pathname));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/entries.json') {
      await ensureFresh();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(state));
      return;
    }
    await serveStatic(decodeURIComponent(pathname), res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`blogsviewer on http://localhost:${PORT}`);
  ensureFresh().catch((err) => console.error(err));
});
