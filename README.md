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

### Importing GPX

**Drives → Import GPX** takes one or more GPX files from a background GPS logger. They go
through exactly the same analysis as live drives. Loggers that include speed in the GPX give
cleaner numbers; without it, speed is worked out from the positions.

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

## Development

```sh
npm install
npm run serve      # http://localhost:4173/smooth-ride/
npm test           # Prettier check, unit tests, Playwright mobile tests
```

Use an installed Chrome for Playwright with `CHROME_PATH=/path/to/chrome npm test`, or run
`npx playwright install chromium` once.

Project rules are in [CLAUDE.md](CLAUDE.md).
