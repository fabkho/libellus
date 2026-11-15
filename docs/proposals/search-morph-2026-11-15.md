# The search palette's morph — what changed, and what to do

Assessment, 15 Nov 2026. No application code was changed for this; the only
deliverable is this document.

## TL;DR

Nothing removed the morph to satisfy a test. The fade the owner sees is a
code path that has existed since the morph was born, and it is chosen by
exactly one signal: the OS-level `prefers-reduced-motion` media query. If his
Android reports Reduce Motion, the app is doing what it was told — the
morph machinery (`SearchOverlay.vue`) is intact and the design intent
(`docs/MOTION.md`) is unchanged. The axe/CLS history is a different story
that ended without touching the motion. What remains genuinely unexplained is
the flying magnifier on close, which the fade path cannot produce — that needs
a device to identify.

## 1. The finding

### 1.1 The gate is one line, and it reads only the OS

`web/app/components/shell/SearchOverlay.vue`:

- `play()` at **line 347–348**: `const reduced = prefersReducedMotion()`.
- **Line 356**: `chrome.value = reduced ? 'tabs' : 'morph'` — under Reduce
  Motion the tab bar never hands over; it stays underneath.
- **Line 364**: `reduced ? fadeFrames() : morphFrames()` — the whole ~480-line
  morph (`morphFrames()`, **line 196**: capsule clip-path, icon flight,
  results unroll, shadow scale) is skipped and replaced by `fadeFrames()`
  (**line 330**: two opacity keyframes, veil + palette) at the `standard`
  duration (250 ms).

That is the owner's symptom 1 exactly: a cross-fade, decoupled from the tab
bar. Symptom 3 ("everything else is not really morphing") follows for free.

`prefersReducedMotion()` is defined in the UI base, not the app —
`node_modules/@fabkho/ui/app/utils/motion.ts:38-40`:

```ts
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
```

It reads the OS media query and nothing else. **The app has no motion
setting of its own.** The only user-facing motion-adjacent setting is Glass
(`web/app/stores/glass.ts`, blur strength); there is no Reduce Motion toggle
in Profile or anywhere else. Nothing in the app can force the `reduced` path
except the OS (or the e2e harness — see §1.4).

`useAfterMotion.ts` is unrelated: it only delays late-arriving content until
other motion settles; it reads no setting.

### 1.2 The keyboard does not re-run the morph

The owner reports the fade happens "after the keyboard is up". The open path
runs `play('open')` exactly once per open (`watch(search.isOpen)`, lines
429–451: focus, `nextTick`, `play('open')`). The keyboard's arrival is a
separate mechanism: `useKeyboardInset` feeds a `lift` computed, applied as a
CSS `transform`/`top` transition on the `keyboard` curve
(`.palette`, lines ~646–651). It never calls `play()` again, so there is no
second run that could "end in fadeFrames". If the OS reports Reduce Motion,
the single run already was the fade; the keyboard then lifts the faded-in
palette. Consistent with the report, no second cause needed.

### 1.3 The morph can run on Android — nothing about the device forbids it

The morph is Web Animations (`element.animate`, `fill: 'both'`) over
`getBoundingClientRect()` boxes measured at `play()` time, with the keyboard
lift subtracted out (`lifted()`, line ~192). Chrome for Android supports all
of this. There is one degenerate-geometry fallback worth knowing: if the
capsule, icon, body, palette or glyph SVG is missing at measure time,
`morphFrames()` returns a fade in place (lines 209–215) — a morph that
"looks like a fade" without Reduce Motion being involved. On a normal phone
layout all five exist, so this should not trigger; it is listed here so a
device check can rule it out rather than discover it.

### 1.4 The suite never exercises the morph — a regression here ships unnoticed

`web/playwright.config.ts:77-78` emulates `reducedMotion: 'reduce'` globally.
Every flow therefore takes the `fadeFrames` path. The spec that opted back in
(`search.spec.ts`, `test.use({ reducedMotion: 'no-preference' })`) and the
layout-shift spec that ran the morph open were both deleted on 9 Oct
(`b7d5f451`, see §2.3). The surviving `search-and-add.spec.ts` runs under
`reduce` and asserts only end states (overlay hidden/shown, focus, URL). The
axe scans likewise run under `reduce` (§2.2). **There is currently no
automated check that the morph plays at all.**

## 2. The history: the morph was never traded for axe/CLS

### 2.1 The gate is as old as the morph

- `85fbbd9f` (2 Oct 2026, "turn the tab bar into the search palette and
  back"): created the morph machinery **and** the `prefersReducedMotion()`
  gate in the same commit, with the commit message stating it plainly: "With
  Reduce Motion the palette and veil cross-fade in place instead." The morph
  never ran unconditionally in this repo. Nothing was later "given up".
- `c96ca17e` (6 Oct, "keep the search palette's boxes still while its results
  arrive"): the CLS fix. Cloudflare field data put the Library at CLS 1.0;
  the largest shift was the palette's shadow (0.475) because the palette grew
  upwards with each answer. The fix was **layout, not motion**: the palette is
  laid out at full room height from the first frame and the content height is
  drawn via `--palette-gap` translation (a translation is not a layout
  shift). Measured result quoted in the commit: 1.0 → 0.07 on typing,
  0.69 → 0 on close. The `reduced`/`fadeFrames` lines were not touched.

So the owner's memory is half right: there were layout-shift errors, and they
were fixed — but the morph was never the price. The fade he remembers being
"traded" for silence predates the CLS fix by four days and was a deliberate
accessibility path from birth.

### 2.2 No axe rule was ever suppressed for this

- "axe" is `axe-core` via `@axe-core/playwright` (`web/package.json:67`);
  there is no chart/graph module by that name (the only other "axe" mentions
  are code comments quoting axe rule names in `WhatsNewSheet.vue` and
  `FeedRow.vue`). The owner's "axe module" is the e2e accessibility scan.
- The scan's allowlist, `ALLOWED` in `web/e2e/support.ts:400`, is **empty**:
  no rule has ever been waived for any screen, let alone the palette.
- The palette is scanned under `reducedMotion: 'reduce'` (`a11y.spec.ts`,
  "the search palette and its results"), i.e. axe has only ever seen the
  faded-in end state, after `untilStill`. The morph and axe never met, so the
  morph was never changed to satisfy axe. (This cuts both ways: axe passing
  says nothing about the morph either.)

### 2.3 What the test history actually did to the morph

- `fcd87fb5` (7 Oct): e2e runs with Reduce Motion on by default for speed;
  motion specs opt back in. The morph still had its spec.
- `b7d5f451` (9 Oct): "drop the motion, layout and polish flows" — deleted 17
  spec files including `search.spec.ts` (morph open/close by every path) and
  `layout-shift.spec.ts` (which ran the morph with `no-preference` and
  asserted CLS ≤ 0.05 with the morph playing). From that day the morph has
  had zero automated coverage. A regression that made the non-reduced path
  look like a fade — or an OS-level change on the owner's phone — would ship
  without a single red check. This is the most likely explanation for "it
  used to morph and now it doesn't" *if* his device does not report Reduce
  Motion (see §4).

## 3. The options

### A. Ignore Reduce Motion for this interaction (the owner's instinct)

Always run `morphFrames()`, never `fadeFrames()`. ~5 lines in
`SearchOverlay.vue` `play()` (plus the same in the reader's `Search.vue:267`
for consistency, and a MOTION.md edit or the docs lie).

What the user sees: the full morph, always. What it risks: this is the one
path that breaks an explicit accessibility guarantee — `docs/MOTION.md`
("Reduce Motion") and `docs/ACCESSIBILITY.md:150` ("honoured everywhere").
People enable Reduce Motion overwhelmingly for vestibular disorders, and a
340 ms scale-and-clip-path flight across the screen is exactly the class of
motion the setting exists to suppress. Axe will not catch the regression
(it does not test `prefers-reduced-motion`); affected users will, by feeling
ill. Cost stated plainly: it trades a documented guarantee for one
interaction's feel.

### B. Morph under Reduce Motion too, but gently

Keep the geometry transition (capsule outline → palette outline, veil fade)
and drop the vestibular triggers: no scale on the shadow, no icon flight
(staggered fade of query row instead), shorter distance, `standard` duration.
Roughly: extend `fadeFrames()` into a small staged cross-fade (~20–30 lines in
`SearchOverlay.vue`), reusing `STAGE` fractions.

What the user sees: position and shape still travel, so the palette reads as
growing out of the tab bar — estimated 90 % of the feel. What it risks:
motion-sensitive users still see movement; but nothing scales, spins or flies
across the viewport, which is where the harm lives. No axe/CLS impact (end
states unchanged, still transform/opacity/clip-path only). This is the option
that keeps the guarantee while recovering the feel.

### C. Keep the gate; fix whatever makes the non-reduced path look like a fade

If the device check (§4) shows his Android does **not** report Reduce Motion,
the fade has a different cause — the §1.3 degenerate fallback, a timing
issue in measurement, or something in the Android keyboard/visual-viewport
path — and that is a bug, not a policy. Cost: unknown until diagnosed, but it
is the only option that is a fix rather than a trade; A and B would paper
over it.

### D. Cover the morph in e2e again (recommended regardless)

Resurrect a small `search-morph.spec.ts` with `reducedMotion:
'no-preference'`: open/close by Cancel, backdrop tap and Escape asserting
`chrome` handover (`shell.tabs` hidden while open), plus a frame-progress
assertion (two samples of the body's clip-path mid-open differ). ~60 lines,
no app code, runs in the `@full`/nightly tier per `docs/TESTING.md`. This is
what would have caught the current situation either way.

## 4. What needs a device to confirm

1. **The one decisive check** (30 seconds, Chrome DevTools on his phone or
   any Android Chrome): evaluate
   `matchMedia('(prefers-reduced-motion: reduce)').matches`. If `true`, the
   whole report reduces to "his OS asks for no motion" — likely Android
   Settings → Accessibility → "Remove animations" (which Chrome honours), or
   a manufacturer/oem equivalent. No code changed anything; §2 stands as the
   full explanation and option C is moot. **Proven in code; the device value
   is the one unread fact.**
2. **The flying magnifier on close is unexplained by the fade path.**
   `fadeFrames()` animates opacity on veil + palette only; nothing flies.
   Candidates: the tab bar's own icon transition on handover, the reader
   palette (which has its own `reduceMotion` prop path), or the morph running
   degenerately on close. Needs a screen recording with the close path
   identified — inferred, not proven.
3. **Whether the non-reduced morph still plays correctly on current Android
   Chrome** (clip-path + WAAPI, keyboard-lift interplay): no e2e covers it
   (§1.4) and there is no Android runner for this interaction
   (`web/e2e/android/` covers the cover flight, not search). Needs the
   emulator script treatment or a real phone.
4. Claims marked accordingly above: the gate, the history and the empty
   allowlist are proven from code and history; everything about his
   particular phone is inferred until check 1 is done.

## 5. Recommendation

**Do check 1 first — it decides everything and costs nothing.** If his phone
reports Reduce Motion, the app is honouring his own OS setting, and the
honest resolution is either to turn the OS setting off (the morph returns
with zero code changes) or to adopt **B**, which keeps the accessibility
guarantee and recovers nearly all of the feel. **Do not adopt A without
weighing its cost**: it knowingly breaks a documented accessibility promise
for users with vestibular disorders, in exchange for an effect B delivers at
~90 % with no such cost. Adopt **D** in any case — the morph currently ships
without a single automated witness, which is how this question arose at all.
