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

"New canvas with shortcode" picks a random 4-letter code. Named rooms use whatever
name you type (lowercased). The presenter shows the code, the URL and a QR code at the top.

## Present mode

- The board is a loop of up to 120 frames (the length of the longest gif in the
  library, capped at 120) played at 15 fps. Each stamped gif is written frame-by-frame into
  every slot of the loop, so the whole board animates.
- Loop frames are allocated once and reused. Their resolution is picked to fit a
  memory budget (256 MB, 128 MB on low-memory devices; override with `&budget=<MB>`).
- Fading: the board fades faster when lots of painting is going on and slower when
  idle (half-life 8 s busy → 120 s idle). Fading stops once ~20% of the board is black.
- Each painter's last cursor position is drawn on top and fades out over 10 seconds.
- `&debug` shows ring size, live stamp count, activity, black share and fade rate.

## Paint mode

Fullscreen trackpad (no accelerometer):

- **one finger**: move the cursor and paint
- **two fingers**: move the cursor without painting (stays move-only until all fingers lift)
- **top-left ✕**: hold 5 s to leave and go back to code entry
- **top-right gif**: hold 5 s to open the gif picker

The hold delay is there so you can paint hands-free without leaving by accident.

## Gif library

Source gifs live in `assets-src/` (`sprites/<name>.<frames>.png` strips and
`gifs/*.gif`). `npm run build:sprites` trims them, caps them at 120 frames and 192 px,
and packs each into a grid spritesheet (WebP with alpha) plus a thumbnail sheet
and `public/sprites/manifest.json`.

## Develop

```sh
npm install
npm run build:sprites   # only after changing assets-src/
npm run dev
npm run build           # writes docs/ for GitHub Pages
```
