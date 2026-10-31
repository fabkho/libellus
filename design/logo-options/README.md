# BetterReads: logo options

Directions for a mark that fits the new name. Nothing here is used by the app yet: the current
icons (`design/icons/app/`, Two ribbons), `web/public/`, the manifest and the emails are untouched.
Once one is picked, its `icon.svg`, `monochrome.svg` and `favicon.svg` replace the three sources in
`design/icons/app/` and `web/scripts/render-icons.mjs` renders the PNGs as today.

![All six options side by side](overview.png)

Round 3: the owner kept 1 and 6; 10 and 11 are new and build on them (2–5 and 3, 7–9 were
dropped in the earlier rounds). The numbers stay as they were so a reply can name an option
without confusion.

| # | Option | Idea | Room |
| --- | --- | --- | --- |
| 1 | [Bookmark B](1-bookmark-b/sheet.png) | A capital B whose stem is today's ribbon, swallowtail and all | leather red (today's, no shift) |
| 6 | [Lamp over the page](6-lamp-over-page/sheet.png) | The lamp rising behind an open book like the sun | dusk plum (shift) |
| 10 | [Lamp B](10-lamp-b/sheet.png) | 1 and 6 in one: a B whose upper bowl is the lit lamp | warm near-black (slight shift) |
| 11 | [Reading lamp](11-reading-lamp/sheet.png) | A pendant reading lamp glowing over an open book | deep wine (shift) |

Each option's sheet has the rationale, the palette, the icon on iOS and Android home screens (and
as a themed icon), every mask, the favicon in a browser tab and at its real pixels, the monochrome
mark as a notification badge, and the lock-ups in the light and the dark theme.

## Files per option

| File | What it is |
| --- | --- |
| `icon.svg` | Android adaptive / `maskable`: 108 dp canvas, full-bleed room, the mark inside the 66 dp safe zone |
| `icon-ios.svg` | iOS / `any`: the same room, the mark at about 60 % of the tile (iOS rounds the corners itself) |
| `favicon.svg` | 32 × 32 rounded square, the mark simplified and enlarged for 32 and 16 px |
| `monochrome.svg` | the mark as one alpha shape (themed icons, notification badge) |
| `wordmark-{light,dark}.svg` | lock-up, mark and name side by side, in the theme's ink and accent |
| `wordmark-stacked-{light,dark}.svg` | lock-up, name under the mark |
| `sheet.png` | the contact sheet |

All lettering is outlined (Geist and Newsreader, the app's faces, both OFL); no SVG loads a font or an
image. Colours are the tokens' (`surface`, `ink`, `accent`, `cloth*`, `clothInk`); where an option
moves the room off today's leather red, its sheet says so.

## Rebuilding

`marks.mjs` holds each mark's geometry (a 100 × 100 box) and copy; `build.mjs` fits the marks into
every canvas, outlines the lettering and renders the sheets in Chromium. Its dependencies are not
part of the repo; the header of `build.mjs` says how to install them.
