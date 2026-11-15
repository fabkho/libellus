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

## Closed: the guard fires nowhere the owner can reach

- Reader layout (`layouts/reading.vue`) has no tab bar but never opens the
  *shell* palette — the reader has its own search (`Reader.vue:1018`,
  `components/reader/Search.vue`, `data-reader-morph`, own guard). Cannot
  produce this symptom.
- `layouts/tabs.vue` mounts `TabBar` for every tab screen, pushed or not.
- `chrome` writers: only `SearchOverlay.vue` writes the shared
  `useSearchChrome` state (`'morph'`/`'palette'`/`'tabs'`); `Reader.vue`'s
  `chrome` is an unrelated local ref. And `invisible`
  (`visibility: hidden`) keeps layout boxes — it trips no existence guard and
  `getBoundingClientRect` still measures.

The fade is **not** the guard firing on a missing element.

## Breakthrough: on Chrome Android there is no inset — the page resizes

- `web/nuxt.config.ts:230`: viewport meta carries
  `interactive-widget=resizes-content` — Chrome on Android shrinks the page to
  what the keyboard leaves.
- `useKeyboardInset`: on Chrome Android the layout viewport shrinks with the
  visual one, "this reads 0 and nothing is lifted twice".

So on the owner's device `keyboard` → 0, `lift` → 0, permanently. There is no
inset to arrive late; the page itself moves.

Mechanism, fitting every symptom ("keyboard opens, half a second later the
palette is visible, already formed"):

1. `play('open')` runs ~2 ticks after the tap — keyboard not yet up, layout
   viewport still full height. `morphFrames()` measures `box`, `outline`,
   `travel` against that stale geometry and hands WAAPI keyframes to
   `element.animate` (~340 ms).
2. The keyboard opens; the page **resizes**; the palette is laid out somewhere
   else entirely (its `bottom` now stands on the shrunken page bottom). The
   animation keeps running against the old geometry.
3. When it ends, the palette "appears" where the new layout put it —
   already formed, no visible morph out of the tab bar.

Fix direction: **re-measure after the resize, not wait for an inset.**
`play()` already supports restarting mid-flight (cancels animations,
re-measures from `shown()`/`timeAt`). Watch the layout viewport height while
the palette is open; on a meaningful change during the opening, `play()`
again from current progress — at most once or twice per open, never after
`settle()`, never if the re-play would itself resize.
## Measurement: not yet done

No browser run yet. Next: a Playwright spec with
`reducedMotion: 'no-preference'` that opens search and logs, at `play('open')`
measure time, `reduced / capsule / icon / iconSvg / glyph / glyphSvg` plus the
`chrome` value — and asserts the palette's `clip-path` differs between two
samples mid-open (morph plays) vs stays `none` (fade path taken).
