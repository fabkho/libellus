# App icon: two ribbons

Idea 04 of the icon round (#83), chosen in #86: two bookmark ribbons, the shorter one
carrying the lamp (the accent dot, glowing) in a warm leather-red room. The three SVGs are
the sources; `web/scripts/render-icons.mjs` renders the PNGs and the favicon from them
into `web/public/` (`cd web && node scripts/render-icons.mjs`).

| File | What it is | Becomes |
| --- | --- | --- |
| `icon.svg` | 108 dp adaptive canvas, full-bleed background, the mark inside the 66 dp safe zone | `icon-192.png`, `icon-512.png` (`any`), `icon-maskable-512.png` (`maskable`), `apple-touch-icon.png` |
| `monochrome.svg` | the same mark as one alpha shape, no background | `icon-monochrome-512.png` (`monochrome`; the launcher tints it for themed icons) |
| `favicon.svg` | rounded square, the mark enlarged for 32 and 16 px | `favicon.svg`, `favicon.ico` (32 + 16) |

The ribbons are plain paths (no font at runtime). Chrome themes an installed app's icon from the
maskable one (Chromium issue 40277264), so the ribbons' bold silhouette has to survive the mask.

## Shortcut icons

`shortcuts/{search,progress,library}.svg` are the icons of the manifest's app shortcuts (long-press the
app icon, #91): the same leather-red room as `icon.svg`, each with its own mark inside the 66 dp safe
zone, rendered at 96 px to `web/public/shortcut-<name>-96.png` by the same script. Search is a magnifier whose
lens holds the lamp, Update progress the shorter ribbon with the lamp beside it, Library the two ribbons.
