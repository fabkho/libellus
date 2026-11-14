# Two letterform icons for BetterReads, from the Gmail board

Exploration only. Nothing ships, nothing is applied. Sheet: `sheet.html` (screenshot: `sheet.png`).
Both are SVG-only, house grammar (`<title>` first, gradients in `<defs>`, no filter/image/style).

## The three things borrowed from `/Users/fabkho/Downloads/gmail_icons.jpg`

1. **2026 M — a monoline letter with rounded caps, filled with one horizontal spectrum gradient** (red → orange → yellow → green → blue) instead of flat brand colours; the two diagonal strokes meet in an overlapping V at the middle.
2. **2049 GMAIL — capitals cut into flat saturated blocks, one bright colour each** (blue G, red envelope-M, yellow A, blue I, green stepped L), no gradients at all; the letters are straight-cut blocks sitting shoulder to shoulder.
3. **2035 mark + wordmark — restraint in flat geometry, charm in the colour**: a hard-edged flat gradient chevron next to a plain black serif "Gmail", and (2110) letters inside one hairline rounded-rect enclosure with colour only in small ticks.

## 01 — Gradient B (`01-gradient-b/`)

A monoline capital B drawn as one rounded stroke on the app's dusk-plum tile, filled with a five-stop spectrum gradient (magenta → red → amber → green → blue); borrows board icon **2026** (gradient monoline letterform) for the construction and the stroke, with the plum tile kept. Proposed new token if it ever shipped: `--icon-spectrum` (the five-stop gradient), tile stays `plum`.
It would work as an app icon at large sizes — bold, legible, unmistakably a B — but it says nothing about reading, and the spectrum reads Google-adjacent rather than BetterReads.

## 02 — Block br (`02-block-br/`)

A lowercase `br` cut from flat saturated blocks (blue stem, red b-bowl with a punched counter, green r) on the app's cream tile; borrows board icon **2049** (flat-block letters, one colour each, no gradient) for the whole construction. Proposed new tokens if ever shipped: `--icon-block-blue/red/green` (the three saturated flats), tile stays `cream`.
It would not work as the app icon: at large sizes it reads as loose coloured squares, the `r` is a green corner rather than a letter, and the spacing between b and r falls apart.

## Verdict

Neither beats "Lamp over the page" (the open book with the lamp rising behind it like the sun in a dusk-plum room). The lamp says reading, night, company; these say "an app starting with B". Of the two, 01 is the only plausible direction and 02 is a failed study kept for honesty. "The current mark is better" — no winner manufactured.

At 16 px in a browser tab: 01 survives (the redrawn favicon keeps a readable B with its gradient, catches the eye on plum); 02 does not (the favicon drops the `r` entirely and the survivor reads as a red-blue blob, not a letter). The favicons are the proof.

What I could not do well: hand-drawn letterform SVG is optical work I did by numbers, not by eye. The B's two bowls are geometric arcs with no overshoot correction, so the lower bowl looks pinched next to the upper; the middle join has no ink-trap thinning and blurs at small sizes. The `br` has flat terminals with no optical alignment, the b-counter is a punched rectangle with dead corners, and the r never became a letter — it is two rectangles hoping. Stroke-to-counter ratios were guessed per size rather than drawn from a typeface's masters.
