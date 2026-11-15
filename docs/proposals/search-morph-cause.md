# Why the search palette fades instead of morphing — diagnosis (in progress)

Owner report: on Android Chrome, opening search fades in place instead of morphing
out of the tab bar. Reduce Motion is ruled out (owner sees cover flights, so
`prefersReducedMotion()` is false; the reduced path is not taken).

Suspect: the silent degenerate guard in `morphFrames()`
(`web/app/components/shell/SearchOverlay.vue:211-217`): if any one of
capsule / icon / body / palette / glyphIcon is missing at measure time, the
whole morph silently becomes a two-element fade. Exact symptom.

## Proven false: the `svg`-not-there-yet timing suspicion (brief §1)

`UiIcon` (`@fabkho/ui` layer, `Icon.vue`) is a plain synchronous component: the
`<svg>` root is inline in its template, every icon a `v-else-if` branch of
inline SVG paths. No sprite, no async chunk, no `v-html` fetch — the `<svg>`
element exists in the DOM in the same tick as its parent.

Both icon instances in play are such `UiIcon`s:

- the tab bar's `[data-morph="search"]` (`TabBar.vue:100`), mounted with the bar;
- the palette glyph's `UiIcon name="search"` (`SearchOverlay.vue:554`).

`play('open')` runs after `rendered = true` + two `await nextTick()`s, so the
`v-if="rendered"` subtree (palette, body, veil, glyph) is flushed before
measuring. A missing inner `svg` at measure time is essentially impossible on
any platform, Android included. Do not "fix" this by waiting another frame:
there is nothing to wait for.

Also note the measured `glyphIcon` is queried from the **palette's** glyph
span (`glyph.value?.querySelector('svg')`), always rendered — not from the tab
bar's icon. It is the least likely of the five to be absent.

## Still open: which of the other four is missing, and when

- `[data-morph="capsule"]` (`TabBar.vue:69`, the `<nav>`) — always mounted in
  `layouts/tabs.vue` (line 84), including pushed screens ("search works from
  every page"). Absent only on pages using another layout. **Reader layout
  (`layouts/reading.vue`) not yet checked** — if the owner opens search from
  the reader and that layout has no tab bar, the fade is the guard working as
  designed, and the fix belongs elsewhere (morph from the palette's own rest,
  or keep the bar mounted under the reader).
- `chrome` writers: only `SearchOverlay.vue` writes the shared
  `useSearchChrome` state (`'morph'` on open, `'palette'`/`'tabs'` on settle);
  `Reader.vue`'s `chrome` is an unrelated local ref. Writers audit incomplete
  (line ~482 context, `still`/`away` CSS effects on measurability unchecked).
- `invisible` (`visibility: hidden`, applied when `chrome !== 'tabs'`) keeps
  layout boxes, so `getBoundingClientRect` still measures — visibility does not
  trip the guard, which tests existence only. `away`/`still` CSS unchecked.

## Measurement: not yet done

No browser run yet. Next: a Playwright spec with
`reducedMotion: 'no-preference'` that opens search and logs, at `play('open')`
measure time, `reduced / capsule / icon / iconSvg / glyph / glyphSvg` plus the
`chrome` value — and asserts the palette's `clip-path` differs between two
samples mid-open (morph plays) vs stays `none` (fade path taken).
