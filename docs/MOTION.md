# Libellus — Motion Language

Motion in D is quiet: things arrive softly and leave quickly, nothing bounces, nothing moves for
its own sake. Every duration and curve is a token in `design/tokens.json` (`duration.*`,
`easing.*`), exposed as `--duration-*` and Tailwind's `ease-*`; no other value is written anywhere.

## Laws

1. **Arrive slow, leave fast.** Entrances use `standard` or `sheet` easing at their duration;
   exits use `exit` easing and a shorter duration.
2. **Move only what changed.** A sheet slides, the page under it does not; the tab dot fades, the
   tab bar stays.
3. **Follow the finger.** Anything that can be swiped follows the drag 1:1 and either lets go
   (dismiss) or springs back with its own enter curve.
4. **State before motion.** With Reduce Motion, every transition finishes at once; the state still
   changes.

## Tokens

| Token | ms | Easing | Used for |
|---|---|---|---|
| `instant` | 100 | `standard` | Press feedback: a button scales to 0.97 |
| `quick` | 150 | `standard` | Small state changes: a tab lighting up, the switch, a field's rule, code cells |
| `standard` | 250 | `standard` | Crossfades, a cover fading in over its thumbhash, the avatar menu opening |
| `exit` | 200 | `exit` | The avatar menu closing; anything small leaving |
| `sheet` | 380 | `sheet` | A sheet rising, its scrim fading in |
| `sheetExit` | 260 | `exit` | A sheet falling away |
| `overlay` | 280 | `sheet` / `standard` | The search palette rising (transform / opacity), its veil fading in |
| `overlayExit` | 200 | `exit` | The search palette and veil leaving |
| `caret` | 1100 | steps | One blink of a drawn caret (the code input) |

| Easing | Curve | Character |
|---|---|---|
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | Fast out of the gate, long soft landing |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | Accelerates away |
| `sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | The iOS sheet curve |

Swift gets the same values (`Tokens.Duration`, `Tokens.Easing` as `TimingCurve`).

## Named motions

- **Press.** Buttons scale to 0.97 over `instant`; no colour flash. Rows darken to `fillStrong`
  while pressed.
- **Tab.** The new tab's icon goes full ink and its lamp dot fades in over `quick`; the old one
  recedes. The page itself swaps without a transition (tabs are places, not a sequence).
- **Avatar menu.** Opens from its top-right corner: fade plus a 0.96 → 1 scale and a 4 px drop,
  `standard`; closes the same way back, `exit`. Flipping the theme inside it crossfades nothing —
  the colours change at once, the switch's knob slides over `quick`.
- **Sheet.** Rises from below the screen edge (`translateY(100%)` → 0) over `sheet` with the
  `sheet` curve; the scrim fades in alongside. Leaves over `sheetExit` with `exit`. Swipe down on
  it: it follows the finger, and closes when dragged more than 80 px or flicked faster than
  0.5 px/ms, otherwise it settles back (`web/app/composables/useSwipeDown.ts`).
- **Search overlay (now).** The veil (blur and tint over the page) fades in over `overlay`; the
  palette rises 24 px and fades in from 0.98 scale with the `sheet` curve, while the tab bar fades
  out over `standard`. Closing reverses it over `overlayExit`. Swipe down works as on a sheet.
  With the keyboard up the palette moves to sit right above it.
- **Cover.** The image fades in over its thumbhash or colour over `standard` once decoded; no
  zoom, no slide.
- **Search results.** A new answer replaces the list in place, best match at the bottom; while a
  newer query is on its way the old list dims to 60 % over `standard` instead of emptying. Before
  the first answer one still ghost row (no shimmer) stands in. The far end of the list fades out
  under a mask.
- **Caret.** The lamp caret in the code input blinks in steps over `caret`, like a text caret.

## Later

- **Tab bar ↔ search palette morph (#21).** As iOS 26 and Apple Books do it: the capsule widens
  into the palette; the Search icon slides into the query row while Home and Library stay put;
  the result list unrolls upwards. Closing reverses all of it. Until then the crossfade above.
- **Push to book detail** and back. #6 ships the book page without a transition: it replaces the
  page at once (its navigation starts on touch-down and its data is asked for then, so it is
  usually complete when it appears), and back returns to the kept-alive page at its old scroll
  position. A push with `standard` and a pop with `exit`, with the cover travelling from the list
  into the hero, is still open.

## Reduce Motion

`prefers-reduced-motion: reduce` sets every transition and animation to 1 ms in
`web/app/assets/css/main.css`, so sheets, menus and the overlay appear and disappear in place and
the caret stops blinking. Nothing depends on an animation finishing.

## Non-motions

No parallax, no bouncing or overshoot, no skeleton shimmer (thumbhashes and the source strip say
"loading"), no page transitions between tabs, no animated theme change.
