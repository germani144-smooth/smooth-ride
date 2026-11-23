# Smooth Ride

A personal "Strava for smooth driving". It scores how smoothly you drive (gentle braking,
gentle acceleration, low jerk) and, like Strava segments, keeps your personal bests on
stretches of road you drive often. Built for hypermiling: smooth driving saves fuel,
brakes and passengers' stomachs.

Live: `https://germani144-smooth.github.io/smooth-ride/` (GitHub Pages from `main`). Open it on the
phone and choose "Install app".

## How it works

- **Installable PWA.** Plain static files, no build step and no runtime dependencies
  (a pinned copy of Leaflet will be added for maps). Runs fully offline after the first visit.
- **Your data stays on your phone.** Everything is stored in the browser under keys starting
  with `smooth-ride.`. Nothing is sent anywhere. Use **Settings → Export** for a backup file,
  and **Import** to restore it (the file is versioned, so old backups keep working).
- **Updates.** The service worker keeps one cache per version (`smooth-ride-<version>`) and
  serves files cache-first. When a new version is published, the app checks on start and
  whenever you return to it, downloads the whole new version in one go, and reloads once
  (never while you're typing or recording a drive). **Settings → Check for updates** checks
  right away.
- **Driving next to Google Maps.** The live view is made for Android split screen: in a
  short strip it drops everything but a row of big numbers.
- **Security.** A strict Content Security Policy allows only this app's own address and the
  OpenStreetMap tile server. No inline scripts; user and imported text is never parsed as HTML.

### Moving between tabs

Tap a tab in the bottom bar, or swipe left/right anywhere on the screen (it behaves like Lift
Log's swipe):

- **Starting:** a swipe starts once the finger is 10 px sideways and 1.2× more sideways than
  vertical. It's cancelled only if the finger first moves more than 12 px vertically _and_
  more vertically than sideways, so scrolling still wins but diagonal thumb swipes work.
  Once started it stays a swipe.
- **Following:** the page moves 0.55× the finger and fades (down to 65%) as you drag toward
  the next tab. A label at the screen edge ("Settings ›" / "‹ Drive") fades in with the drag.
- **Switching:** at 70 px the label and that tab's button light up, and letting go switches
  tab: the new tab slides in from 40 px on that side (0.2 s). Shorter swipes spring back
  (0.18 s). At the first or last tab the page only moves a little (0.15×, at most 24 px) and
  nothing switches.
- You can rest your finger before swiping: a long press doesn't open a menu or select text.

Swiping never starts with two fingers, in fields, on the bottom bar, in dialogs, or on the
map and charts. It's off on the live numbers and completely off while a drive is recording,
so nothing switches by accident while driving. With "reduce motion" turned on in Android,
tabs switch without the slide.

### Recording a drive

Mount the phone, tap **Start** on the Drive tab, then open Google Maps in split screen. The
strip shows four big numbers:

- **Smooth:** a 0-100 score over the last 10 seconds (green 75+, amber 50+, red below).
- **Jerk:** how abruptly acceleration changes, RMS over the last 10 s, in m/s³. Lower is smoother.
- **Harsh:** harsh brakes, harsh accelerations and sharp corners so far this drive.
- **km/h:** current speed.

The screen stays on while recording (the app must stay visible, which split screen does).
The drive is saved every few seconds, so a crash or reload doesn't lose it. Tap **Stop** to
finish; the drive appears on the **Drives** tab.

### Car data (OBD-II, optional)

With an ELM327 Bluetooth adapter in the car's OBD port, the app also reads the car itself,
like Torque does:

1. Pair the adapter once in Android's Bluetooth settings (PIN usually 1234 or 0000). Close
   Torque or any other OBD app first: the adapter talks to one app at a time.
2. Ignition on, then tap **Connect car** on the Drive tab and pick the adapter (only the
   first time; after that it reconnects straight away).
3. Tap **Start** as usual.

While connected, the last live tile shows **fuel use** instead of speed: L/100 km while
moving, L/h while standing still. RPM is shown under the button. Each drive recorded with
the car connected gets a **Car data** section: L/100 km, litres used, litres burned idling,
average and max RPM and throttle, and how much of the drive the engine was cold (under
70 °C, when it burns more).

How fuel is worked out: from the car's own fuel-rate reading when it has one, otherwise from
the mass air flow sensor (litres per hour = grams of air per second × 3600 ÷ (14.7 × 740),
i.e. petrol's air/fuel ratio and density). This is the same method Torque uses; it reads a
little high when you coast in gear (the engine cuts fuel but air still flows), and it
assumes a petrol engine. Consumption per 100 km uses the drive's GPS distance. The
smoothness score still comes from GPS only, so drives with and without the car connected
compare fairly.

It needs Chrome on Android (Bluetooth serial arrived in Chrome 137) and a Bluetooth Classic
adapter; Wi-Fi adapters can't be reached from a web app.

### Importing GPX

**Drives → Import GPX** takes one or more GPX files from a background GPS logger. They go
through exactly the same analysis as live drives. Loggers that include speed in the GPX give
cleaner numbers; without it, speed is worked out from the positions.

### Your overall score

The top of the **Drives** tab shows your overall score: every drive's score weighted by its
distance, so a 40 km drive counts ten times as much as a 4 km one. For example, 40 km at 80
plus 4 km at 30 gives (80×40 + 30×4) / 44 = 75. Live and GPX drives both count; demo drives
and drives too short to score don't. It updates as you add or delete drives, and when the
scoring is retuned.

### Seeing a drive on the map

To try it without driving, tap **Drives → Demo drive**: it adds a simulated 3.4 km drive
around Amager Fælled in Copenhagen (made up, not anyone's real trip) with smooth stretches, one
harsh brake, one harsh acceleration and one sharp corner, and opens it on the map. Delete it
whenever you like.

Tap a drive on the **Drives** tab to open it. Like on Strava, the route is drawn on an
OpenStreetMap map, coloured by how smoothly you drove each stretch:

- **Green, smooth:** under 1 m/s² of braking or acceleration and under 1.5 m/s² sideways.
- **Amber, firm:** noticeable, but fine.
- **Red, harsh:** past the harsh-event limits below.

Red dots mark each harsh brake, amber dots harsh accelerations and purple dots sharp corners;
tap one to see what it was. The green pin is the start, the dark pin the finish. Drag and
pinch to move around (dragging on the map never switches tab). Tap the drive again to close it.

The colours come from the same analysis as the score, so the map and the numbers agree. Map
tiles are loaded from OpenStreetMap when you open a map (they need a connection); the
request carries only the app's address, never your drives, and your route itself is drawn on
the phone.

### How the score is worked out

All numbers come from GPS (speed and heading), not from the phone's motion sensors, so they
don't depend on how the phone is mounted, and live drives and GPX files score the same way.

- Speed and acceleration are smoothed (about 1.5 s), then **jerk** is the rate of change of
  acceleration. **Lateral acceleration** is speed times the rate of heading change.
- **Harsh events:** braking below -2.5 m/s², accelerating above 2.0 m/s², or cornering above
  3.0 m/s², counted once per manoeuvre.
- **Score** = 100 × e^-(0.4 × RMS jerk + 0.2 × RMS acceleration + 0.05 × harsh events per
  10 km), using moving time only. Calm driving lands around 80+, aggressive around 30. Drives
  under 30 s or 200 m get no score.
- **Braking loss** is the kinetic energy shed while braking, in kJ per tonne per km: energy
  you paid for in fuel and turned into brake heat. Lower is better for hypermiling.
- Fixes less accurate than 30 m are ignored, and a gap over 10 s (a tunnel) restarts the
  calculation without counting a fake event.
- When the scoring changes, stored drives are re-scored automatically.

### Coming next

1. Segments: pick a start and end on a recorded drive, nested segments, personal bests, with
   a map (OpenStreetMap tiles via a pinned Leaflet copy).
2. Live comparison against your best while driving through a segment.

## Code layout

Plain static files, no build step. Logic that can be tested without a browser lives in
`js/core/` (pure, unit tested); the rest of `js/` wires it to the page.

| File                    | What it does                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `index.html`            | The page: tabs, live view, Drives and Settings; CSP; loads the CSS and `js/app.js` |
| `manifest.webmanifest`  | Installable app: name, icons, fixed id `/smooth-ride/`                             |
| `sw.js`                 | Service worker: caches every app file per version, serves them offline             |
| `css/base.css`          | Colours, reset, typography, buttons                                                |
| `css/layout.css`        | Header, scrolling content area, bottom tab bar, swipe between tabs                 |
| `css/live.css`          | Live view: big numbers, Start/Stop, split-screen strip                             |
| `css/drives.css`        | Drives list and a drive's stats                                                    |
| `css/map.css`           | Drive map, legend, Leaflet colours                                                 |
| `css/profile.css`       | Overall score card                                                                 |
| `css/car.css`           | Connect car bar and Car data stats                                                 |
| `css/settings.css`      | Settings cards                                                                     |
| `js/app.js`             | Starts everything: tabs, backup Export/Import, service worker updates              |
| `js/version.js`         | The app version (must match `sw.js` and `package.json`)                            |
| `js/live.js`            | Recording: GPS → analyzer → live numbers, wake lock, saving the drive              |
| `js/drives.js`          | Drives tab: profile score, list, drive details, GPX import, demo drive             |
| `js/map.js`             | Loads Leaflet on demand and draws a drive's route, events and pins                 |
| `js/car.js`             | Connect car button, OBD polling loop, live fuel use, rows for the drive            |
| `js/obd-serial.js`      | Bluetooth Classic link to the ELM327 through Web Serial                            |
| `js/swipe.js`           | Swipe gesture wiring (passive touch listeners)                                     |
| `js/db.js`              | IndexedDB storage for drives (`smooth-ride.db`)                                    |
| `js/core/analysis.js`   | The analyzer: speed, acceleration, jerk, harsh events, score                       |
| `js/core/geo.js`        | Distance and bearing between coordinates                                           |
| `js/core/gpx.js`        | GPX file parser                                                                    |
| `js/core/drives.js`     | Drive records: compact fixes, finalizing, validation, sorting                      |
| `js/core/track.js`      | What the map draws: route coloured smooth/firm/harsh, events, bounds               |
| `js/core/profile.js`    | Overall score: drives weighted by distance                                         |
| `js/core/demo.js`       | The simulated demo drive                                                           |
| `js/core/elm.js`        | ELM327 protocol: init, reply parsing, PID decoding, polling session                |
| `js/core/car.js`        | Car data in drives: compact rows, fuel and RPM summary, live consumption           |
| `js/core/swipe.js`      | Swipe numbers and decisions (start, cancel, follow, fade, switch)                  |
| `js/core/format.js`     | Display formatting: distance, duration, speed, score colour                        |
| `js/core/backup.js`     | Versioned Export/Import file format                                                |
| `js/core/storage.js`    | Prefixed `smooth-ride.` key/value storage                                          |
| `js/core/update.js`     | When an app update may reload the page                                             |
| `js/core/escape.js`     | HTML escaping for user text                                                        |
| `vendor/leaflet-1.9.4/` | Pinned, unmodified copy of Leaflet (maps)                                          |
| `tests/unit/`           | Unit tests for `js/core/` and the repo rules (`node --test`)                       |
| `tests/e2e/`            | Playwright browser tests on a phone and in split screen                            |
| `tests/fake-elm.js`     | Simulated ELM327 clone, used by unit and browser tests                             |
| `tests/server.js`       | Local static server under `/smooth-ride/`, like GitHub Pages                       |

## Development

```sh
npm install
npm run serve      # http://localhost:4173/smooth-ride/
npm test           # Prettier check, unit tests, Playwright mobile tests
```

Use an installed Chrome for Playwright with `CHROME_PATH=/path/to/chrome npm test`, or run
`npx playwright install chromium` once.

Project rules are in [CLAUDE.md](CLAUDE.md).
