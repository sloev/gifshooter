# gifshooter

Collaborative gif painting: one big screen presents an animated canvas, phones join
with a short code and paint on it with animated gifs, using the phone as a trackpad.

Live: https://sloev.github.io/gifshooter/

## How it connects

Peer-to-peer WebRTC via [Trystero](https://github.com/dmotz/trystero), signalled
through Trystero's default set of **public Nostr relays**. There's no server of our own;
the site is static (GitHub Pages from `docs/`).

To use other relays, add `&relays=wss://relay.one,wss://relay.two` to the URL (both
screen and phones need the same list).

## Rooms

| URL | What |
| --- | --- |
| `/` | Landing: enter a canvas code, or start presenting |
| `?c=public` | The public canvas, anyone can join |
| `?c=<code>` | Paint on a named room or shortcode room |
| `?c=<code>&present` | Present that canvas on a big screen |

The Present field is pre-filled with a random 5-letter code; you can type your own
room name instead. The presenter shows a small strip at the top with a QR code,
the code and the URL.

## Present mode

- The board is a loop of up to 120 frames (the length of the longest gif in the
  library, capped at 120) played at 15 fps. Each stamped gif is written frame-by-frame into
  every slot of the loop, so the whole board animates.
- Strokes are smoothed and stamped densely, so a drag leaves one continuous "worm".
  Each stamp along the stroke runs one gif frame behind the previous one, so the
  animation ripples along the worm from tail to head. New stamps show up at display
  rate (the phone sends its cursor at ~60 Hz), not in 15 fps steps.
- Loop frames are allocated once and reused. Their resolution is picked to fit a
  memory budget (256 MB, 128 MB on low-memory devices; override with `&budget=<MB>`).
- Fading: the board fades faster when lots of painting is going on and slower when
  idle (half-life 8 s busy → 120 s idle). Fading stops once ~20% of the board is black.
- Every painter gets their own colour (the screen picks the hue furthest from the ones
  already in use). Their cursor shows as a dot in that colour on the big screen, fading
  out over 10 seconds, so you can paint while watching the wall.
- Spritesheets load on first use; beyond ~160 MB decoded, the least recently used
  ones that no live stroke needs are released.
- `&debug` shows ring size, live stamp count, activity, black share and fade rate.

## Paint mode

Fullscreen trackpad (no accelerometer):

- **one finger**: move the cursor and paint
- **two fingers**: move the cursor without painting (stays move-only until all fingers lift)
- **top-left ✕**: hold 1 s to leave and go back to code entry
- **top-right gif**: hold 1 s to open the (animated) gif picker
- the cursor and trail on the phone use your colour; you start with a random gif

The hold delay is there so you can paint hands-free without leaving by accident.

## Install as an app

gifshooter is an installable PWA ("Add to Home Screen" / the install button in the
address bar). Installed, it opens fullscreen, which suits paint mode.

A service worker (generated at build time from `src/sw-template.js`) precaches the app
shell, so it starts instantly and works offline up to the point of connecting.
Spritesheets are cached the first time they're used. Each deploy gets a new cache
version and old caches are dropped.

## Gif library

Source gifs live in `assets-src/`: `sprites/<name>.<frames>.<cols>.webp` (lossless frame
grids, trimmed to the visible area), `gifs/*.gif`,
and `generated/`, which holds procedural loops (hearts, planets, abstract shapes, early-3D
wireframes and flat shading, Blender-style iridescent blobs, a weird pink elephant) rendered by
`npm run generate:gifs` from `scripts/procedural/gifs.mjs`. `npm run build:sprites`
trims them all, caps them at 120 frames and 192 px, and packs each into a grid
spritesheet (WebP with alpha), plus an animated thumbnail sheet for the picker
and `public/sprites/manifest.json`.

The animated logo and the app icons are rendered by `npm run generate:logo`
(`scripts/generate-logo.mjs`).

## Develop

```sh
npm install
npm run dev
npm run build           # writes docs/ for GitHub Pages (commit it)
```

Only needed after changing the assets or their generators:

```sh
npm run generate:gifs   # scripts/procedural/ -> assets-src/generated/
npm run generate:logo   # logo.webp, icons, favicon
npm run build:sprites   # assets-src/ -> public/sprites/
npm run build:assets    # all three
```

## Layout

| Path | What |
| --- | --- |
| `src/main.js` | Landing page and routing to paint / present |
| `src/present.js` | Big screen: frame ring, stamping, fading, painter markers |
| `src/paint.js` | Phone: trackpad, hold buttons, gif picker |
| `src/net.js`, `src/rooms.js` | Trystero rooms and room codes |
| `src/library.js` | Gif library manifest and spritesheet helpers |
| `src/sw-template.js` | Service worker (filled in by `vite.config.js`) |
| `scripts/` | Asset generators and the spritesheet packer |
| `assets-src/` | Source gifs and lossless frame grids |
| `public/` | Static files copied into the build (sprites, logo, icons, manifest) |
| `docs/` | Built site served by GitHub Pages |
