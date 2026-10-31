# BetterReads: logo options

Directions for a mark that fits the new name. Nothing here is used by the app yet: the current
icons (`design/icons/app/`, Two ribbons), `web/public/`, the manifest and the emails are untouched.
Once one is picked, its `icon.svg`, `monochrome.svg` and `favicon.svg` replace the three sources in
`design/icons/app/` and `web/scripts/render-icons.mjs` renders the PNGs as today.

![All six options side by side](overview.png)

Round 8: the owner keeps 1 and 6, likes the ideas of 18 and 19 (not yet their drawings), and
asked for six more ideas: 20 to 25. The numbers stay as they were so a reply can name an option
without confusion.

| # | Option | Idea | Room |
| --- | --- | --- | --- |
| 1 | [Bookmark B](1-bookmark-b/sheet.png) | A capital B whose stem is today's ribbon, swallowtail and all | leather red (today's, no shift) |
| 6 | [Lamp over the page](6-lamp-over-page/sheet.png) | The lamp rising behind an open book like the sun | dusk plum (shift) |
| 18 | [Locked diary](18-locked-diary/sheet.png) | A keyhole through a book's cover, its stem a bookmark ribbon, the lamp's light inside | deep mulberry (shift) |
| 19 | [Paper boat](19-paper-boat/sheet.png) | A printed page folded into a paper boat, its sail amber, setting off | night-sea blue (shift) |
| 20 | [Page kite](20-page-kite/sheet.png) | A printed page flown as a kite, its tail tied with ribbon bows | dusk-sky blue (shift) |
| 21 | [Balloon](21-balloon/sheet.png) | A hot-air balloon lit like the lamp, rising, a book for its basket | twilight rose-violet (shift) |
| 22 | [Lighthouse](22-lighthouse/sheet.png) | A tower of three books, the lamp its lantern, guiding you to the next read | slate night (shift) |
| 23 | [Wax seal](23-wax-seal/sheet.png) | Amber wax pressed with a bookmark ribbon: an invitation, sealed | deep green (shift) |
| 24 | [Constellation](24-constellation/sheet.png) | Stars joined into an open book, one lit amber | midnight indigo (shift) |
| 25 | [Night window](25-night-window/sheet.png) | A window lit at night, books on the sill as silhouettes | ink-teal night (shift) |

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
