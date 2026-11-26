# Smooth Ride: rules for working on this repo

Smooth Ride is a personal smooth-driving tracker PWA (Strava-style segments, scored on
smoothness, not speed). Served by GitHub Pages from `main` at `https://germani144-smooth.github.io/smooth-ride/`.

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

- CSP (meta tag in `index.html`): own address (`'self'`) only, plus two map tile addresses
  in `img-src` only: `https://tiles.stadiamaps.com` (dark map) and
  `https://tile.openstreetmap.org` (fallback). No other hosts (unit tests enforce this, and
  that the CSP matches `TILE_HOSTS` in `js/core/tiles.js`).
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

- Static files, no build step, no dependencies, except pinned local copies under `vendor/`
  (never a CDN): Leaflet, and two OFL fonts in `vendor/fonts/` (DSEG7 Classic Bold for readouts,
  Atkinson Hyperlegible 400/700 for text) with their licence files. Dev tools (Prettier,
  Playwright) are devDependencies only.
- Core logic is pure (no DOM) in `js/core/` and has unit tests in `tests/unit/`.
  `js/app.js` is UI wiring only.
- One analysis pipeline: live recording and imported GPX files go through the same
  `createAnalyzer().push()` in `js/core/analysis.js`. Kinematics come from GPS only, so
  scores don't depend on phone mounting and both sources compare fairly.
- When scoring changes, bump `ANALYSIS_VERSION`; stored drives are re-scored on load.
- Never reload the page for an update while a drive is recording.
- Swipe between tabs behaves exactly like Lift Log's. Every number lives in `SWIPE` in
  `js/core/swipe.js` (unit tested); `js/swipe.js` listens on the whole document with passive
  touch listeners only, no library; respect `prefers-reduced-motion`. Mark anything that pans or drags with
  the finger (map, charts) `data-noswipe`. No swiping on the live view or while recording.
- Maps: Leaflet 1.9.4 is a verbatim copy under `vendor/leaflet-1.9.4/` (all its files are
  precached), loaded on demand by `js/map.js`. Tiles: Stadia Maps "Alidade Smooth Dark",
  authenticated by the app's domain registered in the user's Stadia account (no API key
  anywhere), falling back to plain OpenStreetMap after 3 refused tiles with none loaded
  (`js/core/tiles.js`). Both with `referrerPolicy: "strict-origin-when-cross-origin"`: send
  only the origin. Keep the Stadia, OpenMapTiles and OSM attributions. No filters on tiles.
  Popups get DOM nodes, never HTML strings. What the map draws comes from `buildTrack` in
  `js/core/track.js` (same analyzer as the score). Override Leaflet's CSS with
  `.drive-map.leaflet-container …` selectors, since `leaflet.css` loads after ours. Browser
  tests stub both tile servers; never hit Stadia or OSM from tests.
- Car data: ELM327 over Bluetooth Classic through Web Serial (`js/obd-serial.js`, SPP
  filter). The protocol is pure in `js/core/elm.js` (transport injected) and fuel maths in
  `js/core/car.js`; both are unit tested against the simulated clone in `tests/fake-elm.js`,
  which the browser tests also inject as a fake serial port. OBD rows are stored on the
  drive as `obd`; the score never uses them (GPS only).
- The page is pinned to the screen (`body { position: fixed; inset: 0 }`); only `<main>`
  scrolls.
- Live view must work in Android split screen next to Google Maps (short strip, big numbers);
  the `split-screen` Playwright project checks this.

## Design (v1.0, "trip computer")

- Dark warm cabin with an amber 7-segment LCD display. Colours are tokens on `:root` in
  `css/base.css` (`--cabin`, `--lcd`, `--ghost`, `--line`, `--amber`, `--text`, `--dim`,
  `--red`, `--green`, `--smooth`); use them, don't add new hex values in other CSS. `js/map.js` mirrors
  them for Leaflet.
- Amber is the display and the accent; red is harsh and Stop; smooth is quiet cream on maps
  and the drive strip, so only firm (amber) and harsh (red) stand out. Live scores (instant and
  trip) take a tone from `scoreTone` in `js/core/lcd.js`: red below 70, amber 70-90, green
  above 90, and the arch and flat bar follow the instant score. Everything else stays amber.
- Numbers that are readouts use the LCD readout (`setReadout`/`createReadout` in `js/lcd.js`):
  DSEG7 digits right-aligned over ghost 8s (its decimal point has zero width, so "0.4" sits
  over "8.8"; ghost text comes from `ghostFor` in `js/core/lcd.js`). The element
  with the digits keeps plain text (tests read it). Other text is Atkinson Hyperlegible.
- The arched bar graph over the live score is the one bold element; keep everything else
  quiet. Its geometry is `archGeometry` in `js/core/lcd.js` (also used for the app icon).
- Two tabs, Drive and History; Settings is the cog in the header (not a tab, not swiped to).
- Start/Stop sits at the bottom of the Drive tab, in thumb reach. The split-screen strip
  shows score (with a flat bar), Trip, Harsh and km/h stacked (labels beside the digits),
  and Stop; no header, no jerk. Labels on the live view stay big (about 1.15rem).
- No middle-dot meta strings, no all-caps labels; sentence case.

## Code layout

- README.md has a "Code layout" table of every file and what it does. Keep it current when
  adding, moving or renaming a file.
- CSS is one file per area in `css/` (base, layout, live, history, map, profile, car,
  settings), loaded in that order from `index.html` and listed in `PRECACHE`. Later files
  build on earlier ones, so keep the order. Name sections by area, never by version. A new
  area gets its own file, added in both places.
- Use full names in code (`state`, `options`, `speed`, `accel`, `interval`), not single
  letters, except short loop indices. Stored field names (drive summaries, compact fix and
  OBD rows, backups) are a storage format: don't rename them without a migration.

## Before every push

- `npm test` passes: Prettier check, unit tests, Playwright mobile tests.
- One version bump per release, in `js/version.js`, `sw.js` and `package.json` together
  (a unit test checks they match). Tell the user the new version number.
- Keep `README.md` (including "How it works") up to date whenever a change affects it.
