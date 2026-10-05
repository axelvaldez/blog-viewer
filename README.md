# blog viewer

A blog viewer based on [Kagi Small Web](https://kagi.com/smallweb/): a top bar of controls over a full-size iframe showing one post at a time, drawn from the RSS/Atom feeds listed in `feeds.txt`.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:4173 (override with `PORT`). The local server re-fetches the feeds every 15 minutes and whenever `feeds.txt` changes.

## Deploy (Netlify)

The deployed site is static. `npm run build` fetches every feed once and writes the result to `public/entries.json`; Netlify publishes `public/`. The settings are in `netlify.toml`.

New posts only appear after a rebuild: push a commit or trigger a deploy from the Netlify dashboard.

## Feeds

`feeds.txt` holds one feed URL per line; blank lines and `#` comments are ignored. Point at a different file with `FEEDS_FILE`.

## Layout

- `feeds.js` — fetches and parses the feeds, and checks which sites forbid embedding.
- `build.js` — writes the static `public/entries.json` snapshot.
- `server.js` — local development server; serves `public/` and a live `/entries.json`.
- `public/` — the viewer: top bar plus iframe. Posts are embedded by their web URL, not the feed content.
