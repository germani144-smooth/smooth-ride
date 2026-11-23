# Smooth Ride: rules for working on this repo

Smooth Ride is a personal smooth-driving tracker PWA (Strava-style segments, scored on
smoothness, not speed). Served by GitHub Pages from `main` at `https://<org>.github.io/smooth-ride/`.

## Scope

- Work only on this repo. Never touch Nap Log, Lift Log, Home log (cart-log) or RideGuide.

## Address and PWA identity

- Own address. Never share an origin or path with Nap Log, Lift Log, Home log or RideGuide.
- Installable PWA. `manifest.webmanifest`: `scope` and `start_url` are `"./"`, `id` is
  `"/smooth-ride/"`. **Never change the id** (it would install as a different app).

## Service worker (`sw.js`)

- Caches are named `smooth-ride-<version>`. Touch only our own caches and our own scope;
  never delete or read other caches, never handle requests outside our scope or origin.
- Cache-first.
- Install fetches every file fresh (`?v=<version>` plus `cache: 'reload'`) and fails as a
  whole if any file fails.
- Every app file must be in `PRECACHE` (a unit test enforces this).
- The page calls `reg.update()` on start and when it becomes visible, and reloads once on
  `controllerchange`: not on first install, not while the user is typing (wait for blur).

## Security

- CSP (meta tag in `index.html`): own address (`'self'`) only, plus the OpenStreetMap tile
  address `https://tile.openstreetmap.org` for map images. No other hosts.
- No inline scripts, no `onclick`/inline handlers, no inline styles.
- Escape all user or fetched text: use `textContent`; if markup must be built, use
  `escapeHtml` from `js/core/escape.js`. Never put user text into `innerHTML` unescaped.

## Data and privacy (public repo)

- No personal data in the repo: no drives, locations, GPX files, exports. No keys.
  Keys stay on the phone (entered in Settings, stored locally).
- `.gitignore` must keep `.claude/settings.local.json`, `*.gpx` and exports out.
- All storage keys (localStorage, IndexedDB names) are prefixed `smooth-ride.`. Data
  stays on the phone.
- Settings has a versioned Export/Import (`js/core/backup.js`). When the data shape
  changes, bump `BACKUP_FORMAT` and add a migration so old exports still import.

## Code

- Static files, no build step, no dependencies, except a pinned local copy of Leaflet
  under `vendor/` (never a CDN). Dev tools (Prettier, Playwright) are devDependencies only.
- Core logic is pure (no DOM) in `js/core/` and has unit tests in `tests/unit/`.
  `js/app.js` is UI wiring only.
- One analysis pipeline: live recording and imported GPX files go through the same code.
- Live view must work in Android split screen next to Google Maps (short strip, big numbers);
  the `split-screen` Playwright project checks this.

## Before every push

- `npm test` passes: Prettier check, unit tests, Playwright mobile tests.
- One version bump per release, in `js/version.js`, `sw.js` and `package.json` together
  (a unit test checks they match). Tell the user the new version number.
- Keep `README.md` (including "How it works") up to date whenever a change affects it.
