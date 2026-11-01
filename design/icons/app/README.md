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
| `icon.svg` | 108 dp adaptive canvas, full-bleed plum room and amber glow, the mark inside the 66 dp safe zone | the mark alone and the night room, below |
| `icon.svg` without its room | the mark on nothing, in the place it holds in the tile | `icon-192.png`, `icon-512.png` (`any`) |
| `icon.svg` without its room, on `surface.dark` | the same mark, full bleed, on one flat night | `icon-maskable-512.png` (`maskable`) |
| `icon-ios.svg` | the plum room, the mark at 60 % of the tile (iOS rounds the corners itself) | `apple-touch-icon.png` |
| `monochrome.svg` | the same mark as one alpha shape, no background | `icon-monochrome-512.png` (`monochrome`; the launcher tints it for themed icons) |
| `favicon.svg` | 32 × 32 rounded square, the mark simplified and enlarged for 32 and 16 px | `favicon.svg`, `favicon.ico` (32 + 16) |

The manifest's `any` icons are the mark alone (#461). A launcher, Chrome's launch frame and its install
sheet each put an icon on a background of their own, so the plum tile arrived as a tile — a square
inside a circle, the square again at 180 px, none of them the room the app opens into; with the tile
gone the mark arrives as the mark. The maskable answers the same problem the other way: a maskable is
full bleed by spec, so its own room is the night the app opens into (`surface.dark`, and
`web/scripts/render-icons.mjs` checks the corners) and what a launcher masks is a night circle, not a
square. Android's splash for an installed app then paints `background_color` behind the icon: the same
night, so the circle's edge goes too and the mark is all that is left.
`apple-touch-icon.png` keeps its plum tile: iOS composites a transparent touch icon onto black.

The maskable keeps the opposite framing: its mark stays inside the 66 dp safe zone, because Chrome
themes an installed app's icon from the maskable source (Chromium issue 40277264), so its silhouette
has to survive the mask, which the gull of the pages and the disc do. The mark is plain paths (no
font at runtime) and one half disc.

## Shortcut icons

`shortcuts/{search,progress,library}.svg` are the icons of the manifest's app shortcuts (long-press
the app icon, #91): the same plum room as `icon.svg`, each with its own mark from the icon's
vocabulary inside the 66 dp safe zone, rendered at 96 px to `web/public/shortcut-<name>-96.png` by
the same script.

- **Search**: a magnifier whose lens holds the lamp, half risen.
- **Update progress**: the open book with the lamp half risen behind it (the icon's mark).
- **Library**: the open book alone, without the lamp.

## The mark in place

`sheets/` holds the pictures the change was judged by: `framing.png` (`icon.svg` against
`icon-ios.svg` at 192 and 180 px), `icon-forms.png` (the maskable icon in a circle and a squircle,
the themed icon, the apple-touch-icon, the favicon at 16 and 32 px in a tab), `shortcuts.png` (the
three shortcuts on a long-press, at 96 and 44 px), `readme-lockup.png` (the README's lock-up in both
themes), and `android-launcher.jpg` / `android-launch.jpg` from Chrome on the emulator
(`docs/TESTING.md`) — the home screen as the mark landed (the white circle is the transparent `any`
alone, with no maskable to carry the night; the night circles are this change), and the frame Chrome
draws before the page paints: the mark alone on the night room, no tile edge. That frame is Chrome's
own and follows its theme, so on a light Chrome the cream mark sits on light grey and nearly
disappears; the system splash Android draws for an installed app comes from the maskable and is the
night circle either way. Chrome on this emulator mints an install through Google Play, which wants an
account, so the system splash itself stays unphotographed.
