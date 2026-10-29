# W6 — verification of "You both read"

Verification of plan H, W6 (`docs/plans/shared-books-slideshow.md`, PR #300) against **#412** (`feat/both-read-reel`,
head `525e4d78`). Nothing here changes the feature: this is what was measured, what it found, and the flows that
keep it. Pictures are in `docs/plans/img/w6/`, the perf JSON under `.shots/w6/perf/` (not committed).

## How it was run

- **A stack of its own**, ports 55720–55729 (`supabase/` copied to `/tmp/libellus-w6-stack`, `project_id =
  "libellus-w6"`, ports rewritten there only — the repository's `supabase/config.toml` untouched).
- **Seeds**: one viewer and five friends she follows (and who follow her), with **0, 1, 2, 12 and 300** shared
  Books. The 12-Book friend also carries a **Manual** Book and a Book whose check failed. Covers are real
  OpenLibrary artwork (`covers.openlibrary.org`, CORS `*` on every hop, which is what the canvas' textures need),
  colours and thumbhashes computed from the pictures the way the import does.
- **The build the flows ship**: `nuxt generate` with `LIBELLUS_E2E=1 LIBELLUS_REGAL=1 REGAL_LAYER=<Regal main
  f3a1b28, #85–#88>`, served like Cloudflare Pages (`web/e2e/serve.mjs`), on the throwaway stack.
- **Playwright**, Chromium (ANGLE/Metal on this Mac; also SwiftShader to confirm the no-GPU path) and WebKit, an
  iPhone viewport 390 × 844 at 3×, motion allowed. 61 checks per engine.
- **Perf**: the same build, Chromium, the plan's profile (4× CPU + Slow 4G), plus an unthrottled series.

## 1. What holds

Verified on both engines unless it says Chromium only. 59/61 (Chromium) and 57/60 (WebKit) checks passed; every
failure is a finding below, not a crash or a wrong sample.

| Plan item | What was seen |
|---|---|
| 0 shared Books | no section at all |
| 1 shared Book | the poster, no canvas, **the `regal` chunk never requested** |
| 2 shared Books | the reel, a dot each, no wrap |
| 12 shared Books | the reel, 12 dots, plays as the filmstrip does |
| 300 shared Books | the reel of **24**, 24 dots (not 300), the list holds **all 300** |
| One round, then rest | plays, then `data-mode=manual` and stays (55 s window) |
| Swipe | takes over (Manual), another Book comes forward, **stays manual after 5 s**, Play resumes |
| Vertical drag | left to the page (`touch-action: pan-y`) |
| Tap a neighbour | it comes forward, no sheet |
| Tap the front Book, mid-play | comes out, the Stack's sheet: **her stars and yours**, Show back / Put back / Open book, **no blurb** |
| Show back / Put back | turns the Book, then closes it |
| System Back | closes the Book, **URL stays on her page**, reel Manual |
| Escape | puts the Book back |
| Open book | pushes `/book/<id>`; Back returns to her page with the Book back |
| Keyboard | ArrowRight/ArrowLeft move the reel, the pause button reads Pause/Play |
| Reduce Motion | poster, no canvas, **no `regal` chunk request** |
| Save-Data | poster, no canvas, no chunk request |
| Reel chunk failing (offline) | poster stays, no page error, the list is there |
| No WebGL | poster, no canvas |
| German | "Beide gelesen · 12", "Einig bei 7 von 10", "Als Liste zeigen", Regal's own words through `labels` |
| Screen reader | carousel named "Bücher, die du und Lena beide gelesen habt", the pause button by name, the text list's links |
| Poster → canvas | the section keeps its height in Chromium (575 → 575 px) |
| Manual and unverified Books | a Manual Book opens its sheet **without** Open book; every catalogue Book offers it |

## 2. Findings

**W6-1 · Medium · the poster and the reel are drawn at once until the canvas says `ready`** — two dot rows and
two captions, overlapping (`img/w6/finding-two-captions.jpg`, `img/w6/film-0ms.jpg`). On this machine 1.2–3.4 s
from navigation; on a phone over a mobile network it is the whole of the chunk's download and the first frame.
`BothRead.vue` fades the poster only on `@ready`, and the reel draws its tooltip, dots and pause button from the
moment it mounts.

**W6-2 · Medium · a tap in that window opens the Book's page instead of the sheet** — until `ready` the poster is
still interactive (`:inert="reelReady"` is false), so the tap lands on the poster's cover link. Reproduced: one tap
at the card's centre 0.9 s after the reel mounts → `/book/<id>`. Once `ready` has come, the same tap opens the
sheet. Same cause as W6-1; hiding the reel's chrome (or making the poster inert) as soon as the reel mounts fixes
both.

**W6-3 · Medium · the slide's accessible name has no numbers** — `" von , Klara and the Sun, Kazuo Ishiguro"` (and
`" of , …"` in English) where the plan asks for "3 of 12". Cause: `BothReadReel.vue` passes
`slide: t('member.bothReadSlide')`, and vue-i18n substitutes an interpolation with **no value passed as an empty
string**, so Regal's `fillLabel` gets `" of "` and has nothing left to fill. Fix in W4:
`t('member.bothReadSlide', { n: '{n}', count: '{count}' })` (the keys already carry `{n}`/`{count}`).

**W6-4 · Low · WebKit grows the section by 48 px when the canvas takes over** — the section measures 527 px while
the poster stands and 575 px once the reel is ready; in Chromium it is 575 px both times. A visible shift on the
browser the app is mostly used in.

**W6-5 · Low · the text list's links carry no `data-testid`** — the `li` carries `member.bothRead.item`, the link
inside it nothing, so the flows' own guard (`everyControlHasATestId`, `e2e/fixtures.ts`) flags every item. The
guard's exception now covers the list (this PR, one line); tagging the link instead would be the tighter fix.

**W6-6 · Low · coming back to her page starts the round again** — Back from a Book's page, or another tab and
back, replays the reel. Fine if "once per visit" means the visit to her page; if it means the visit to the app,
the flag has to live above the component (Regal's `played` is per mount).

**W6-7 · Info · the unverified Book is unreachable through `both_read`** — `private.book_shown` shows a
`check_failed` Book to every member who holds it, and `both_read` only matches Books the caller holds (same id, or
the same work key — and a failed check clears the keys). Seeded a `check_failed` Book for two friends: it shows its
real title in the reel, never "Outside the catalogue". The branch is still right to keep (it is one `if`), but no
member will meet it; the Manual Book, which `bookPathOf` also refuses, is reachable and is covered.

**W6-8 · Info · the perf budgets on the plan's own profile** — see the table: everything passes on a real GPU
unthrottled, and the two time budgets miss at 4× CPU by 0.6–0.7 s and 11–61 ms. Not a defect found in the reel (its
frames and its frame gate are clean); it is the cost of mounting three.js on a mid-range phone, and the plan's own
note ("shader warm-up before `ready`, as the deal does") is what to watch.

## 3. Budgets (section F) against what was measured

Chunk sizes: brotli, quality 11, of the flows' build (`e2e/build.ts`), against the same build of `origin/main`
(`b0aeed62`).

| Budget (F) | Measured | Verdict |
|---|---|---|
| Entry bundle unchanged | 51.2 KB br with Regal on main and with it here; 41.0 → 41.1 KB br without Regal | pass (unchanged) |
| Member page chunk ≤ +4 KB br | 5.8 → 5.8 KB br; the section is its own lazy chunk, **4.3 KB br** | pass |
| Reel code in the `regal` chunk ≤ +12 KB br (deal +9.2) | 287.3 → **296.3 KB br** = **+9.0** | pass |
| Poster at once; canvas ready ≤ 1.2 s after the section nears the view | 943 ms unthrottled; **1771 ms** at 4× CPU (12 Books), **1860 ms** (300) | **miss on the 4× CPU profile** |
| Cold first use: ~350 KB, once per release hash, on idle, never Save-Data | the `regal` chunk is 296.3 KB br, fetched only past the gates; 1 of 1 request per visit | pass |
| Images per round: the front at `xl` once each, ≤ 5 textures live | 5 distinct front images + their `md` copies for the pile; every front fetched once | pass |
| 60 fps during moves, no frame > 33 ms | 240 frames in 4 s, median/p95/worst **17 ms**, 0 frames over 33 ms (playing and swiping, both sizes) | pass |
| 0 rendered frames during holds | **0** GL draws in 3 s of a resting reel | pass |
| 0 off screen, hidden, after the round | **0** GL draws in 4 s scrolled away, **0** in a hidden tab | pass |
| No main-thread task > 50 ms at the mount | 0 ms unthrottled; **61 ms** worst long task at 4× CPU (12 Books), 51 ms (300); LoAF blocking 16–26 ms | pass unthrottled, marginal miss at 4× CPU |
| — (for the record) | JS heap 14.9 MB (12 Books) / 19.5 MB (300); canvas 700 × 660 CSS 350 × 330 | — |

The reel's own rendering is disciplined: one frame when something moved, nothing while it holds, off screen or in
a hidden tab — Regal's frame gate works here as it does on the shelf.

## 4. The flows added (durable)

Cheap enough for the release run, and each guards something a member would notice:

- `web/e2e/both-read.spec.ts` (default project: WebKit, Reduce Motion): no shared Book is no section; one is the
  poster, never the 3D, and **the `regal` chunk is not fetched**; 300 shared Books put 300 in the list and 300 in
  the eyebrow. ~14 s for the two.
- `web/e2e/both-read-reel.spec.ts` (Chromium, motion allowed; skips itself where the build has no Regal or the
  browser no WebGL): the reel plays, a swipe takes it over and only Play brings it back; the Book in front comes
  out with her stars and yours and the three actions, Show back turns it, the system Back closes it and stays on
  her page, Open book pushes its page and Back comes home. ~7 s per flow.
- `web/e2e/bothRead.ts`: the fixture (a friend, the follows, the shared finished Books), tagged with the run so the
  global teardown removes it.
- `web/e2e/fixtures.ts`: two lines of exception in the guards — Regal's reel's own controls (as the shelf's row and
  details already were), and the section's list items (W6-5).

All four pass in 15–19 s, three runs in a row. They read Regal's state off the page (`data-mode`, `data-picked`,
`data-front`, `data-book-count`, the pause button's name), so a change in the layer's wording or markup is what a
failure means.

## 5. Gate 2 — the owner on his phone

- Dev server of #412, on the LAN: **http://192.168.178.82:3108/** (nuxt dev, `--host 0.0.0.0`, port 3108), against
  the throwaway stack, still running (55720–55729). The API and the mailbox are on the LAN too (55721/55724), so he
  needs nothing else on his phone.
- **Sign in**: `dev@libellus.local` — the address only; the six-digit code is mailed to the local mailbox at
  **http://192.168.178.82:55724** (Mailpit → the newest message to that address). No password.
- **Her page, 12 shared Books** (covers are real): **http://192.168.178.82:3108/friends/7d85d035-e700-4a51-8a17-fc789b45f847**
- The other counts, for the empty and the crowded cases: 0 Books `…/friends/89d274cb-52af-441d-8f11-cdd0a46b83b8`,
  1 Book `…/friends/a233aa63-2905-4575-8683-ea91413d399c`, 2 Books `…/friends/81016693-294c-4a68-86f7-ba18b9252928`,
  300 Books `…/friends/7cfa139a-ac8a-4b2f-8628-7bd65f1b97d1`.
- The stack and the dev server stay up until the coordinator says otherwise; nothing else on this machine listens
  on 3108, and no other worker's stack was touched.

## 6. Not verified

- A real iPhone with VoiceOver/TalkBack: the accessible tree was read from Playwright's ARIA snapshots (Chromium
  and WebKit), not from a phone's screen reader.
- Haptics (`out` / `back`), and the fragmented Android tick per Book.
- The 300-Book list scrolled to its end on a phone (the count and the DOM are checked, not the scroll's cost).
- KeepAlive around Your shelf next to a friend's reel with the same Book id (W1's own pick context is Regal's to
  prove; the reel does provide its own).
- The new flows in CI (they ran locally, against this checkout's build and stack).
