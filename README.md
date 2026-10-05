# blog viewer

A blog viewer based on [Kagi Small Web](https://kagi.com/smallweb/): a top bar of controls over a full-size iframe showing one post at a time, drawn from the RSS/Atom feeds listed in `feeds.txt`.

## Run

```bash
npm install
npm start
```

Then open http://localhost:4173 (override with `PORT`).

## Feeds

`feeds.txt` holds one feed URL per line; blank lines and `#` comments are ignored. Point at a different file with `FEEDS_FILE`. Feeds are re-fetched every 15 minutes and whenever the file changes.

## Layout

- `server.js` — fetches and parses the feeds, serves `GET /api/entries` and the static frontend.
- `public/` — the viewer: top bar plus iframe. Posts are embedded by their web URL, not the feed content.
