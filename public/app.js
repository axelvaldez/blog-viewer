const $ = (id) => document.getElementById(id);
const stage = $('stage');
const nextBtn = $('next');
const backBtn = $('back');
const randomBtn = $('random');
const copyBtn = $('copy');
const openEl = $('open');

let entries = [];
let queue = [];
let position = -1;

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// Round-robin by recency: every feed's newest post first (feeds in random order),
// then every feed's second newest, and so on until the longest feed runs out.
function buildQueue(entries) {
  const byFeed = Map.groupBy(entries, (e) => e.feedUrl);
  const feeds = [...byFeed.values()].map((posts) =>
    // Feeds with undated posts keep the order the feed gave them.
    posts.every((e) => e.date) ? posts.toSorted((a, b) => b.date.localeCompare(a.date)) : posts,
  );
  const rounds = Math.max(...feeds.map((posts) => posts.length));
  const result = [];
  for (let round = 0; round < rounds; round++) {
    result.push(...shuffle(feeds.filter((posts) => round < posts.length).map((posts) => posts[round])));
  }
  return result;
}

function showStatus(message) {
  const p = document.createElement('p');
  p.className = 'status';
  p.textContent = message;
  stage.replaceChildren(p);
}

function showBlocked(entry) {
  const box = document.createElement('div');
  box.className = 'status blocked';

  const logo = document.createElement('img');
  logo.src = '/logo.gif';
  logo.alt = '';

  const site = document.createElement('a');
  site.href = entry.siteUrl;
  site.target = '_blank';
  site.rel = 'noopener';
  site.textContent = entry.feedTitle || entry.domain;
  const reason = document.createElement('p');
  reason.append(site, ' no permite que su contenido sea embebido en sitios externos.');

  const title = document.createElement('strong');
  title.textContent = entry.title;
  const link = document.createElement('a');
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.append('Lee ', title, ' en su sitio original');
  const read = document.createElement('p');
  read.append(link);

  box.append(logo, reason, read);
  stage.replaceChildren(box);
}

function showFrame(entry) {
  // A fresh iframe per post keeps the embedded page out of this tab's back/forward history.
  const frame = document.createElement('iframe');
  frame.src = entry.url;
  frame.title = entry.title;
  frame.referrerPolicy = 'no-referrer';
  // No allow-top-navigation: embedded pages can't break out of the viewer.
  frame.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms';
  stage.replaceChildren(frame);
}

function show(index) {
  position = index;
  const entry = queue[position];
  if (entry.embeddable) showFrame(entry);
  else showBlocked(entry);

  openEl.href = entry.url;
  document.title = `${entry.title} · ¡Blog!¡Blog!`;
  backBtn.disabled = position === 0;

  const here = new URL(location.href);
  here.searchParams.set('url', entry.url);
  history.replaceState(null, '', here);
}

function next() {
  if (!queue.length) return;
  if (position + 1 >= queue.length) {
    queue = buildQueue(entries);
    show(0);
    return;
  }
  show(position + 1);
}

function back() {
  if (position > 0) show(position - 1);
}

// Shows a random post from the whole dataset as a detour: it is slotted in right after the
// current post, so Anterior returns here and Siguiente carries on with the queue.
function random() {
  if (!entries.length) return;
  let entry;
  do {
    entry = entries[Math.floor(Math.random() * entries.length)];
  } while (entries.length > 1 && entry === queue[position]);
  // If the post was still ahead in the queue, move it rather than show it twice.
  const ahead = queue.indexOf(entry, position + 1);
  if (ahead !== -1) queue.splice(ahead, 1);
  queue.splice(position + 1, 0, entry);
  show(position + 1);
}

nextBtn.addEventListener('click', next);
backBtn.addEventListener('click', back);
randomBtn.addEventListener('click', random);

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href);
  copyBtn.classList.add('copied');
  setTimeout(() => copyBtn.classList.remove('copied'), 1200);
});

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'ArrowRight') next();
  else if (e.key === 'p' || e.key === 'ArrowLeft') back();
  else if (e.key === 'r') random();
});

async function init() {
  let data;
  try {
    const res = await fetch('/api/entries');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    showStatus(`No se pudieron cargar las entradas: ${err.message}`);
    return;
  }

  if (!data.entries.length) {
    nextBtn.disabled = true;
    randomBtn.disabled = true;
    showStatus(
      data.feeds.length
        ? 'Ninguno de los feeds en feeds.txt devolvió entradas.'
        : 'Aún no hay feeds. Agrega las URL de los feeds a feeds.txt, una por línea.',
    );
    return;
  }

  entries = data.entries;
  queue = buildQueue(entries);
  // A shared ?url= link opens that post first, but only if it comes from one of our feeds.
  const wanted = new URLSearchParams(location.search).get('url');
  const found = queue.findIndex((e) => e.url === wanted);
  if (found > 0) queue.unshift(...queue.splice(found, 1));
  show(0);
}

init();
