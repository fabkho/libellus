# App icon: Lamp over the page

The app's mark is an open book with the lamp rising behind it like the sun, in a dusk-plum room
(cloth5, lifted). It is option 6 of the logo rounds, chosen in #448: the design's founding image
("a reading lamp in a dark room") turned into a picture instead of a sign — the pages are cream
(`clothInk`), the lamp half disc is the accent amber with its glow, and nothing in it is a letter.

The sources here are copies of `design/logo-options/6-lamp-over-page/` (which keeps the rounds'
sheets, the motion and the backlog). `web/scripts/render-icons.mjs` renders every PNG and the
favicon from them into `web/public/` (`cd web && node scripts/render-icons.mjs`).

| File | What it is | Becomes |
| --- | --- | --- |
| `icon.svg` | 108 dp adaptive canvas, full-bleed room, the mark inside the 66 dp safe zone | `icon-maskable-512.png` (`maskable`) |
| `icon-ios.svg` | the same room, the mark at 60 % of the tile (iOS rounds the corners itself) | `icon-192.png`, `icon-512.png` (`any`), `apple-touch-icon.png` |
| `monochrome.svg` | the same mark as one alpha shape, no background | `icon-monochrome-512.png` (`monochrome`; the launcher tints it for themed icons) |
| `favicon.svg` | 32 × 32 rounded square, the mark simplified and enlarged for 32 and 16 px | `favicon.svg`, `favicon.ico` (32 + 16) |

`any` and `apple-touch-icon` take the iOS framing, not `icon.svg`: at 192 and 180 px the fuller tile
carries better than the maskable one, whose mark has to leave room for a launcher's mask (compared
side by side when the mark landed). The mark is plain paths (no font at runtime) and one half disc:
Chrome themes an installed app's icon from the maskable source (Chromium issue 40277264), so its
silhouette has to survive the mask, which the gull of the pages and the disc do.

## Shortcut icons

`shortcuts/{search,progress,library}.svg` are the icons of the manifest's app shortcuts (long-press
the app icon, #91): the same plum room as `icon.svg`, each with its own mark from the icon's
vocabulary inside the 66 dp safe zone, rendered at 96 px to `web/public/shortcut-<name>-96.png` by
the same script.

- **Search**: a magnifier whose lens holds the lamp, half risen.
- **Update progress**: the open book with the lamp half risen behind it (the icon's mark).
- **Library**: the open book alone, without the lamp.
