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
  (never while you're typing). **Settings → Check for updates** checks right away.
- **Driving next to Google Maps.** The live view is made for Android split screen: in a
  short strip it drops everything but a row of big numbers.
- **Security.** A strict Content Security Policy allows only this app's own address and the
  OpenStreetMap tile server. No inline scripts; user and imported text is never parsed as HTML.

### Coming next

1. Record a drive: GPS plus motion sensors, live smoothness score, jerk and harsh events.
2. Import GPX files from a background GPS logger, analysed with the same code.
3. Segments: pick a start and end on a recorded drive, nested segments, personal bests.

## Development

```sh
npm install
npm run serve      # http://localhost:4173/smooth-ride/
npm test           # Prettier check, unit tests, Playwright mobile tests
```

Use an installed Chrome for Playwright with `CHROME_PATH=/path/to/chrome npm test`, or run
`npx playwright install chromium` once.

Project rules are in [CLAUDE.md](CLAUDE.md).
