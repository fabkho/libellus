# BetterReads: logo options

Six directions for a mark that fits the new name. Nothing here is used by the app yet: the current
icons (`design/icons/app/`, Two ribbons), `web/public/`, the manifest and the emails are untouched.
Once one is picked, its `icon.svg`, `monochrome.svg` and `favicon.svg` replace the three sources in
`design/icons/app/` and `web/scripts/render-icons.mjs` renders the PNGs as today.

![All six options side by side](overview.png)

Round 2: the owner kept 1, 3 and 6 from the first round; 7, 8 and 9 are new (2, 4 and 5 were
dropped). The numbers stay as they were so a reply can name an option without confusion.

| # | Option | Idea | Room |
| --- | --- | --- | --- |
| 1 | [Bookmark B](1-bookmark-b/sheet.png) | A capital B whose stem is today's ribbon, swallowtail and all | leather red (today's, no shift) |
| 3 | [Read-tick](3-read-tick/sheet.png) | An open book whose short and long pages make a tick: Finished | forest green (shift) |
| 6 | [Lamp over the page](6-lamp-over-page/sheet.png) | The lamp rising behind an open book like the sun | dusk plum (shift) |
| 7 | [Ribbon in the gutter](7-ribbon-in-the-gutter/sheet.png) | An open book with its ribbon hanging out of the gutter | midnight blue (shift) |
| 8 | [Reading glasses](8-reading-glasses/sheet.png) | Read better, literally: reading glasses, the lamp as a glint in one lens | the app's Night room (no shift) |
| 9 | [Book B](9-book-b/sheet.png) | A capital B built from books: one standing, two lying, the top one lit | deep petrol (shift) |

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
