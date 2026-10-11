# Pick my next book: prototype findings (#259)

This is a prototype round. Nothing here is a feature yet. The draft PRs are **DO NOT MERGE**:

- Libellus: `prototype/pick-next`
- Regal: `prototype/pick-next` (fabkho/regal#81)

Everything sits behind `?pick=1` (kept for the tab's session) or `LIBELLUS_PICKER=1`. Nobody else sees anything of it. The parity entry is "Pick my next book — PROTOTYPE" in `docs/parity.md`.

## What exists

**Entry: Library → Want to read.** A quiet row, *Pick my next book · Can't decide? Choose a few, let chance pick one.*, sits above the list's filters. It shows when two or more Books are on the list.

Why there and not on Home's empty "now reading" slot:

- It sits where the pile it picks from is.
- It is always reachable. Home's slot only shows when nothing is being read, so a member who is between two Books would never see it there.
- It does not add noise to Home.

Home's slot can link to the same page later (open question 3).

**Step 1: choose the candidates.** `/pick` is a pushed page, with the tab bar away.

- The Want to read list is shown as rows with a check. Tap a row to choose it, tap it again to drop it. The limit is 2 to 12, and the 13th says why it was refused.
- *n of 12 chosen* is a polite live region.
- The chosen Books show as a row of small covers, each with a × to remove it.
- **Search** reuses the app's own search (`stores/search.ts`: her Library, the Catalogue, Apple, OpenLibrary). A result joins as a snapshot and is not added to the Library. An entry she is reading or has finished says why it can't be picked.
- *Pick from n* floats at the bottom.
- The animation chooser sits in the top bar (A Deck / B Stack / C Wheel, one line each). The address takes `?variant=a|b|c` too.

**Step 2: the deal.** The winner is drawn first, then the deal plays.

- **The draw.** `data/pick.ts`, `drawWinner` uses `crypto.getRandomValues`, made unbiased by rejection sampling. The Book picked last is excluded unless it is the only one left. The draw happens *before* any animation; the animation is theatre.
- **The overlay** (`components/pick/Stage.vue`) covers the screen and shows *Picking one of n…*.
- **The same start for every variant:** the chosen covers sit in a row until the deal is ready.
- **Renderers:**
  - In a build with Regal: Regal's `RegalBooksDeal` (`components/pick/Deal3d.vue`, lazy `regal` chunk).
  - Otherwise: the Libellus-only 2D deal (`Deal2d.vue`: a CSS-3D ring of covers, transform and opacity only).
  - `?deal=2d` forces the 2D deal, for comparison.
- **Controls:** a tap, Space or Enter skips. Escape or Back leaves with nothing written.
- **Reduce Motion:** no shuffle. The winner fades in where it ends (about 200 ms).
- **The same end for every variant:** the winner rests upright, front to the camera, centred, about 55% of the stage height. The deal hands its exact on-screen rect to Libellus, which lays a `UiCover` there. That cover then flies into the Book page through the app's normal cover flight (`useBookFlight`).

**Step 3: the result, on the existing Book page.** `components/pick/Bar.vue` is a glass card above the tab bar. On the Book page itself, `pages/book/[key].vue` is untouched; the bar is mounted by `components/pick/Layer.vue` in the tabs layout. The card has:

- At its left, *Round r · n in the running* and *Picked for you: Title*. This is the live region, and it takes focus.
- At its right, **one row of small covers of the others still in the running**, overlapped like a hand of cards. Tapping one lifts it and shows its title in the card, and nothing else.
- *Not this one* and *Start reading*.

I put the others bottom right, inside the card. A separate floating row would have competed with the tab bar and the page's own bottom content. Inside the card, it is read together with the decision it belongs to.

**Rounds.**

- *Not this one* drops the Book and deals the rest again, with a shorter deal (2.2 s instead of 3.6 s).
- When one Book is left, it is shown at once and the card says *The last one left*.
- When none are left, the card shows the quiet *That was all of them* with *Done* and *Choose again*.

**Accept** (`acceptAction` in `data/pick.ts`, tested):

- **An entry on Want to read:** the Start reading action (`start_reading`, today), in one tap. This is the same repository call the Start sheet's button makes. It works offline and syncs later.
- **A Book from search:** the existing Add sheet opens with *Currently reading* chosen, so the Book is added the one way the app adds Books. The pick ends when it has been added.
- **Nothing is written before Accept.** Back, Escape, a tab or a link at any point ends the pick.

**Tests.** Vitest, `web/tests/pick.test.ts`, 20 tests:

- The draw's uniformity: chi-square tests over 60,000 draws with a seeded source and 48,000 with `crypto`.
- No modulo bias.
- No immediate repeat.
- Select, remove, the cap, the search add, the mix of entries and snapshots.
- The rounds: decline, the last one, none left.
- The Accept mapping.
- The variant switch.

The Regal side has its own planner tests in `tests/unit/deal.test.ts`. The end pose is exact and no NaN appears; the deck's winner is on top before the turn, the wheel's winner is under the pointer, and the stack's winner is in the middle when the riffle stops.

**The demo script.** `pnpm perf:pick` (`web/perf/pick.ts`, tagged @prototype, outside `pnpm e2e` and `pnpm perf`):

- Drives the whole flow per variant at 390×844@3, touch, dark, motion on: entry, choosing five Books plus one from search, the deal, the result, lighting an other, a decline and a second deal, then Accept (A and B) or declining down to the end state (C).
- Records a video and a frame strip per variant into `/tmp/pick-next-demo/` and the worktree's untracked `.shots/`.
- Measures the deal's frames on a throttled CPU.

**The data.** The dev member was seeded with `pnpm seed:dev`: 54 Want to read with their real Apple, OpenLibrary and Placeholder covers.

**Run it.**

```sh
# 2D only: any build or `pnpm dev`, then open /library?pick=1 (&variant=a|b|c)
# 3D: against the Regal worktree (docs/SETUP.md, the local layer switch)
LIBELLUS_REGAL=1 REGAL_LAYER=/path/to/regal@prototype/pick-next \
NUXT_PUBLIC_REGAL_LIBRARY_SRC=https://books.fabkho.dev/v2/library.json pnpm generate
# the demo and the numbers (a running app on :3100, a stack with the seeded dev member)
PICK_APP=http://localhost:3100 PICK_SUPABASE_URL=http://127.0.0.1:<api port> PICK_STACK_DIR=<stack dir> \
pnpm perf:pick [--gpu] [--deal 2d] [--variants deck,stack,wheel] [--no-demo|--no-measure]
```

Regal's own dev page shows the three variants with synthetic Books: `/dev/deal?variant=deck|stack|wheel&n=6` in its `pnpm dev`.

## The three variants compared

All numbers are from the production build (`nuxt generate`), Chromium at 390×844@3, CPU throttled 4× through CDP, 3 runs each. The deal window runs from the deal's `ready` to the winner resting (`pick:deal:start` to `pick:deal:end`). A "long" frame is one longer than two vsyncs (over 33.4 ms).

| | A · Deck | B · Stack | C · Wheel | 2D (Libellus only) |
|---|---|---|---|---|
| What it is | Fan → face-down deck, two riffles and a cut. The top card (the winner) turns face up. | Regal's Stack: the pile re-sorts (Books slide out and back in), a riffle slows through the Spines until the winner is in the middle, then it is pulled out and stood up. | Covers on a ring spin 2–3 turns against a fixed accent pointer, slow down with a small overshoot, and the winner steps forward. | A CSS-3D ring of covers turns and slows. The winner grows to the end. One motion for all variants. |
| Deal length | 4.36 s (round 2: 2.2 s) | 4.36 s | 4.36 s | 4.72 s |
| Frames, real GPU (M5 Pro, Metal) | 60 fps, p95 16.7 ms, max 16.8 ms, **0 long, 0 LoAF** | 60 fps, p95 16.7 ms, **0 long, 0 LoAF** | 60 fps, p95 16.7 ms, **0 long, 0 LoAF** | 58–60 fps, 0–1 long (first run: one 133 ms cover decode), 0 LoAF blocking |
| Frames, SwiftShader (software WebGL: a weak GPU's worst case) | 51–53 fps, p95 33.4 ms, max 33.5 ms, 2–8 long, 0 LoAF | 54 fps, p95 33.3 ms, 2–6 long, 0 LoAF | 53–56 fps, p95 33.4 ms, max 50 ms, 4–7 long, 0 LoAF | 55–60 fps, 0 long after the first run (one 217 ms decode), 0 LoAF blocking |
| Pick → result card (deal + flight + Book page) | 3–5 long frames, max 67–133 ms, all of them in the Book page's mount and the flight, not the deal. With SwiftShader, one 420–700 ms warm-up before `ready` while the static covers row shows. | same | same | 1–2 long, max 50 ms |
| Bytes, first use | the `regal` chunk: **302 KB br** JS + 9.4 KB br CSS + Spine fonts ≈ 40 KB (Patua One 13 KB, Antonio 26.5 KB) ≈ **350 KB**, the same for all three. Today only the owner ever loads it. `RegalBooksDeal`'s own share is **+9.2 KB br** (+32 KB raw) on top of Regal main's 293 KB br. | same | same | **+8.5 KB br** in the precache (pick page 3.1, stage 1.8, card 1.7, deal 1.6, store, layer and copy); 0 KB up front |
| Offline | Only if the `regal` chunk was fetched before (CacheFirst, `libellus-shelf-code`), else it falls back to 2D on its own (the import's `catch`). Covers from the device's cover cache. | same | same | Works (precached) |
| Feel (my reading of the videos) | The most "game". But for most of the deal you watch identical card backs: your Books disappear. The turn is the best single moment of the three. | Your Books stay legible the whole time (Spines with titles and authors). It reads as browsing your own shelf, slowing on one, taking it out. Most Regal, and the owner's own idea. On a phone with 12 Books the Spines get thin. | Instantly reads as a fair draw (the pointer), with covers visible. Sparse with 2–3 Books, crowded with 12. More game show than bookshop. | Pleasant but generic; it says "random", not "your shelf". |

A finding along the way: the first 3D build stalled once per deal, a ~700 ms long frame (640 ms blocking at 4×) right after `ready`. The cause was three.js linking the shader programs on first use. Regal now warms everything before `ready`: `compileAsync`, a hidden warm-up render with shadows, the floor and the pointer, and a GPU fence. The clock starts only after that.

## Without Regal, and offline

- **A build without `LIBELLUS_REGAL`** (everyone but the owner's build today) never touches Regal. `Deal3d.vue` resolves to the empty stand-in, the guard in `regal.config.ts` still covers it, and the stage deals in 2D. The bytes are +8.5 KB br, all precached, and the deal works offline.
- **A build with Regal** fetches the `regal` chunk only when a deal starts. It is not precached; once fetched it is kept CacheFirst, together with Regal's fonts. If the import fails (offline before the chunk was ever fetched, or a network error), the stage deals in 2D instead. The import's `catch` loads `Deal2d.vue`.
- **Covers:** both deals load the candidates' `xl` artwork (Apple's 600×900; the 3D deal uses a 512 px texture). Offline they come from the service worker's cover cache, or they are drawn.

## Recommendation

1. **The motion: B, the Stack.** It is the only one where the member keeps seeing *her* Books while chance works. It speaks Regal's language (pile, riffle, pull a Book out), and the result lands naturally in "take this one out and start it". Keep A's face-up turn as an idea for the reveal; drop C.
2. **The architecture: hybrid, as built.** Libellus owns the flow: the draw, the rounds, Accept, the result on its own Book page, the flight, a11y and offline. Regal contributes only the 3D renderer (`RegalBooksDeal`: Books in, a decided winner index in, `picked` with the rect out).
3. **Who gets 3D: for now, only builds that already have Regal.** Today that is the owner's. Everyone else gets a **2D version of B**: a CSS riffle through Spine-like strips, which still has to be built; the current 2D deal is a generic ring. Reason: 350 KB on first use for a ~4-second moment is a lot on a phone on mobile data, and the 3D deal is not available offline until then.

   If the owner wants 3D for all, do not ship Regal's whole chunk. First split a `regal-deal` chunk (the deal, three.js and TresJS, without the Stack, Row, Bookcase and Details) and measure it.

## What a real build still needs

- **Copy:** English only so far (`pick.*`, about 45 keys). German follows with #257.
- **A11y:**
  - Already in: the animation is hidden (`role="img"` with a label, canvas `aria-hidden`), the result is a polite live region and takes focus, the keyboard path (rows are checkboxes; Space/Enter skip; Escape leaves), and Reduce Motion.
  - Still to do:
    - A pass with VoiceOver and TalkBack.
    - Focus on the Book page's own heading rather than the card.
    - An axe scan of `/pick` and of the card (`e2e/a11y.spec.ts`).
    - A visually hidden list of the candidates during the deal.
- **The Book page:** the card covers the page's lower content and repeats its *Start reading*. Give the page bottom room while the card shows, or let the card replace the page's action.
- **The real phone:** the Android session of the perf harness (`perf/README.md`). These numbers are Chromium on a Mac with throttled CPU, plus a software-GL worst case.
- **The 2D Stack** (recommendation 3) and the 2D deal's covers: load `md` for the small cards, not `xl`.
- **The chosen Books** live in memory only (a reload starts afresh). Decide whether a pick should survive a reload.
- **Regal:**
  - A real release and the pinned ref for Libellus.
  - The `regal-deal` chunk split.
  - The full typecheck in CI.
  - The deal's copy is the host's; nothing to translate in Regal.
- **Tests:** a Playwright flow only if it becomes a critical path (it isn't). The rules are already in Vitest.

## Open questions for the owner

1. **A, B or C?** My recommendation is B.
2. **3D for everyone**, at about 350 KB on first use and not offline until fetched, or **2D for everyone and 3D for the owner's build**?
3. **The entry:** only the Want to read header (as built), or also Home's empty "now reading" slot?
4. **The limit:** 2–12 hand-picked, or also "all of Want to read" or a Collection, genre or format as the pool? A 50-Book deal needs a different motion.
5. **Accept for a Book from search:** through the Add sheet (one more tap, as built), or one tap like an entry?
6. **Decline:** dropped for this pick only (as built), or remembered ("not now") for the next pick?
7. **The others row:** keep it read-only (lift and title, as built), or let a tap make it the pick?
8. **No immediate repeat across picks:** keep it?
9. **Haptics** on the stop (Android only)? None for now.
10. **Two "Start reading" on the result page** (the page's and the card's): merge them?
