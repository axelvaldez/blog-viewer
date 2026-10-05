import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

export const FEEDS_FILE = process.env.FEEDS_FILE ?? join(import.meta.dirname, 'feeds.txt');
const FETCH_TIMEOUT_MS = 10_000;
const CONCURRENCY = 8;
const EMBED_CHECK_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'blogsviewer/0.1 (personal feed reader)';

// Entities are decoded by hand: the parser's own expansion has limits that large feeds trip.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: false,
});

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return text(v['#text']);
  return decode(String(v)).replace(/<[^>]+>/g, '').trim();
};

function resolveUrl(href, base) {
  try {
    const u = new URL(decode(String(href).trim()), base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function atomLink(link) {
  const links = asArray(link);
  const pick =
    links.find((l) => typeof l === 'object' && l['@_rel'] === 'alternate') ??
    links.find((l) => typeof l !== 'object' || !l['@_rel']) ??
    links[0];
  return typeof pick === 'object' ? (pick?.['@_href'] ?? pick?.['#text']) : pick;
}

function rssLink(item) {
  const link = asArray(item.link).map((l) => (typeof l === 'object' ? (l['@_href'] ?? l['#text']) : l))[0];
  if (link) return link;
  const guid = item.guid;
  const permalink = typeof guid === 'object' ? guid['@_isPermaLink'] !== 'false' : true;
  return permalink ? text(guid) : null;
}

function parseFeed(xml, feedUrl) {
  const doc = parser.parse(xml);
  const rss = doc.rss?.channel ?? doc['rdf:RDF'];
  const atom = doc.feed;
  if (!rss && !atom) throw new Error('not an RSS or Atom feed');

  const feedTitle = text(rss ? (rss.title ?? doc['rdf:RDF']?.channel?.title) : atom.title);
  const channel = doc.rss?.channel ?? doc['rdf:RDF']?.channel;
  const siteUrl =
    resolveUrl(rss ? rssLink({ link: channel?.link, guid: '' }) : atomLink(atom.link), feedUrl) ??
    new URL(feedUrl).origin;
  const items = rss ? asArray(rss.item ?? doc['rdf:RDF']?.item) : asArray(atom.entry);

  const entries = [];
  for (const item of items) {
    const url = resolveUrl(rss ? rssLink(item) : atomLink(item.link), feedUrl);
    if (!url) continue;
    const rawDate = rss
      ? (item.pubDate ?? item['dc:date'])
      : (item.published ?? item.updated);
    const date = new Date(text(rawDate));
    entries.push({
      url,
      title: text(item.title) || url,
      date: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      feedTitle,
      feedUrl,
      siteUrl,
      domain: new URL(url).hostname.replace(/^www\./, ''),
    });
  }
  return { feedTitle, entries };
}

async function fetchFeed(feedUrl) {
  const res = await fetch(feedUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feedUrl);
}

// True when the response headers forbid showing the page in an iframe on another site.
function blocksEmbedding(headers) {
  if (headers.get('x-frame-options')) return true;
  const csp = headers.get('content-security-policy') ?? '';
  return csp
    .split(/[;,]/)
    .map((d) => d.trim().split(/\s+/))
    .some(([name, ...sources]) => name.toLowerCase() === 'frame-ancestors' && !sources.includes('*'));
}

// Embedding rules are checked once per origin, on one sample page, and remembered for a day.
const embedCache = new Map();

async function originBlocksEmbedding(sampleUrl) {
  const { origin } = new URL(sampleUrl);
  const cached = embedCache.get(origin);
  if (cached && Date.now() - cached.checkedAt < EMBED_CHECK_MS) return cached.blocked;
  let blocked = false;
  try {
    const res = await fetch(sampleUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': USER_AGENT, accept: 'text/html, */*;q=0.8' },
    });
    await res.body?.cancel();
    blocked = blocksEmbedding(res.headers);
  } catch {
    // Unreachable right now: let the iframe try, and check again on the next refresh.
    return false;
  }
  embedCache.set(origin, { blocked, checkedAt: Date.now() });
  return blocked;
}

async function pool(items, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

async function readFeedList() {
  let raw;
  try {
    raw = await readFile(FEEDS_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const urls = raw
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  return [...new Set(urls)];
}

// Fetches every feed in feeds.txt and returns the entries plus a per-feed report.
export async function loadEntries() {
  const urls = await readFeedList();
  const feeds = new Array(urls.length);
  await pool(urls, async (url, i) => {
    try {
      const { feedTitle, entries } = await fetchFeed(url);
      feeds[i] = { url, title: feedTitle, entries };
    } catch (err) {
      feeds[i] = { url, title: '', entries: [], error: err.message };
      console.warn(`feed failed: ${url} (${err.message})`);
    }
  });

  const seen = new Set();
  const entries = feeds
    .flatMap((f) => f.entries)
    .filter((e) => !seen.has(e.url) && seen.add(e.url));

  const samples = new Map();
  for (const e of entries) {
    const { origin } = new URL(e.url);
    if (!samples.has(origin)) samples.set(origin, e.url);
  }
  const blockedOrigins = new Set();
  await pool([...samples], async ([origin, sampleUrl]) => {
    if (await originBlocksEmbedding(sampleUrl)) blockedOrigins.add(origin);
  });
  for (const e of entries) e.embeddable = !blockedOrigins.has(new URL(e.url).origin);

  console.log(
    `loaded ${entries.length} entries from ${urls.length} feeds (${blockedOrigins.size} sites block embedding)`,
  );
  return {
    updatedAt: new Date().toISOString(),
    entries,
    feeds: feeds.map(({ entries, ...f }) => ({ ...f, count: entries.length })),
  };
}
