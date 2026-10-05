import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEntries } from './feeds.js';

// Static build: snapshot the feeds into public/entries.json for the viewer to load.
const data = await loadEntries();
// An empty snapshot would publish a blank site, so fail and keep the previous deploy.
if (!data.entries.length) {
  console.error('No entries loaded from any feed; aborting build.');
  process.exit(1);
}
await writeFile(join(import.meta.dirname, 'public', 'entries.json'), JSON.stringify(data));
const failed = data.feeds.filter((f) => f.error).length;
console.log(`wrote public/entries.json (${failed} of ${data.feeds.length} feeds failed)`);
