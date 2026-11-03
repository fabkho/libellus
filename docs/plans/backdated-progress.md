# Progress on an earlier day

**Status: plan, nothing built, WAITING FOR THE OWNER'S "GO"** (§10). Phase 1 of the owner's request: UI options,
data rules, database design, the pull-request plan and who builds what. No feature code, no migration in this
PR. DRAFT, DO NOT MERGE.

**Decided with the owner so far:** the day is chosen with the **platform's native date picker** (a real
`<input type="date">`, as `UiDateRow` does; nothing of our own is drawn) behind the **day pills** (B). Questions
2–4 of §8 are *assumed* as recommended until the owner says otherwise.

Owner's words (intent): *"Let a member record the progress she made on a specific earlier date: she forgot
to update two days ago, seven days ago, yesterday."* In three parts:

1. In the **Update progress sheet** (`web/app/components/book/ProgressSheet.vue`, the wheel) a way to switch
   the day from "today" to any date.
2. In the **Reading log** on the Book page (`web/app/components/book/ProgressLog.vue`) a small **add entry**
   button that opens the sheet as well.
3. **Log entries become editable**: a tap on a row opens the sheet on that day.

Mocks (390 px, light and dark, made from the running app; not in the repo): `/tmp/backdate-mocks/index.html`
(`01-sheet-today`, `02-sheet-earlier-empty-day`, `03-day-options`, `04-log-add`, `05-row-editor`, with
`parts/*.png`, and `parts/*-360.png` for the narrow width; the generator is `/tmp/backdate-mocks/generator/`).

## 1. Recommendation in one screen

| | |
|---|---|
| **Choosing the day** | One row of **day pills** under the Book in the sheet: **Today · Yesterday · Pick a day…** (the look and the 44 pt boxes of Pages \| Percent). "Pick a day…" is the app's own native date picker (the `UiDateRow` technique, `min` = the read's start, `max` = today); once a day is picked the third pill carries it ("Fri 30 Oct"). |
| **What changes in the sheet** | Title "Progress on Fri 30 Oct"; the *Last time* line becomes the range the wheel may move in ("Between Thu · p. 170 and Sat · p. 188"); the wheel opens on the day's end (or on the day before's end when the day has no entry) and runs only between those two; a quiet line says what else changes ("Adds Fri 30 Oct. Sat then reads +10, not +18."). "of 480 ✎" and Finish / DNF are left out. |
| **Reading log** | A hairline pill **+ Add day** at the right of the section head (the look of *See all*). Rows become buttons with a chevron; a tap opens the same sheet on that day. Add opens it on the newest day without an entry. |
| **Remove** | Inside the sheet, only on a day that has an entry: a danger button **Remove this day** (the Edit-read sheet's pattern) and a `UiConfirm` that says where the day's pages go. |
| **Empty day** | Not a row in the log (the log lists days that have an entry). In the sheet: the wheel waits on the day before's end, nothing is added until she moves it. |

Why: **calm, small, no clutter.** The daily path (Today, one wheel, Save) keeps its shape and gains one
quiet row; the usual forgotten day (yesterday) costs one tap; any other day costs the platform's picker; the
log stays a list she already knows, with two things added (a pill and a tap). It reuses patterns the app
already has (pill, date row, danger button + confirm, section-head pill) and adds one small presentational
component (`DayPills.vue`, props in / events out, portable).

## 2. What exists today (verified in the repo, `origin/main` 8c0d016d)

Line numbers are of that commit.

**Database**

- `reading_progress_days(session_id, day, start_page|start_percent, end_page|end_percent, updated_at)`,
  primary key `(session_id, day)`, one start kind at most, exactly one end kind, no negative page, percent
  0–100, rows go with the read (`on delete cascade`); members have `select` only, through a policy on the
  read's entry (`supabase/schema-snapshot/tables/public.reading_progress_days.sql`, `…/policies/…`,
  `…/grants/tables.sql:255`).
- It is written **only** by `public.update_progress` (`supabase/schema-snapshot/functions/public.update_progress(…).sql`):
  - `:25-28` the day is `coalesce(p_day, utc today)` and must be within UTC today ±1, else `date_invalid`
    (so **backdating needs new database behaviour**: nothing older than yesterday can be written today);
  - `:29-43` locks the member's entry row, then the open read (`not_reading` without one);
  - `:80-87` sets `progress_page|progress_percent|progress_updated_at` of the read;
  - `:88-90` `greatest(v_day, max(day))`: a day never goes back before the read's last recorded one;
  - `:91-95` the read's first value set more than a day after `started_on` books no day;
  - `:96-103` insert the row `(start = value before, end = new)` or, on the same day, move only the end;
  - `:104-110` a row that ends where it started is deleted (an Undo, a correction back).
- A row's start is **the read's value before the day's first update**, so consecutive rows chain
  (`start(n+1) = end(n)`), with three legitimate breaks: the first value set late or imported
  (`import_books` sets progress on the read with no row, `…/functions/public.import_books(jsonb).sql:184-187`),
  `clamp_session_progress` (a lower page count cuts the read's page, leaves rows,
  `…/public.clamp_session_progress(…).sql`), and units that differ between rows (a row can start in pages and
  end in percent; the client converts through the page count).
- A day can end **below** where it started (the member goes back): `amountOf` is then negative
  (`web/app/data/progressDays.ts:84-89`), and **the log and the chart hide such a day**
  (`readingLogOf` keeps `amount > 0`, `:152-162`; `dailyAmounts` clamps at 0, `:107-113`). An editable log
  must show it (see R12).
- `public.delete_session` deletes the read and, by cascade, its days (`…/public.delete_session(uuid).sql`).
  `update_session` changes dates only and does not look at the days (an open read's `started_on` can move past a row).
- `public.sync_write(request_id, action, args)` replays queued writes at most once per request id; its
  `'update_progress'` branch moves a day older than yesterday up to yesterday (`…/public.sync_write(…).sql:82-96`)
  because the database takes nothing older. Every migration that adds an action replaces the **whole**
  function (`create or replace`).
- `reading_sessions` triggers: `reading_sessions_activity` (outcome, review), `…_no_future_dates` (dates),
  `…_shelf_publish` (dates, outcome, rating, review: **no progress column**, so Regal's published library is
  untouched by anything here), `…_update_status` (`…/triggers/public.reading_sessions.sql`).
- Buddy reads D2 (draft PR #474, branch `feat/buddy-read-position`, `20261113020000_buddy_read_position.sql`,
  read-only here): `reading_sessions` *after update of progress_page, progress_percent, outcome, ended_on,
  started_on* (with a `WHEN old distinct from new`) refreshes the member's Section (`buddy_refresh_entry`),
  from the read's **current** value only; it never reads `reading_progress_days`. Its header (lines 51-58)
  notes the lock order it depends on: `update_progress` holds her entry row, then waits for the room's lock.

**Client**

- `data/library.ts:626-631` `updateProgress(entryId, progress, total?, day?)`; `:939-956` builds the args,
  `queuedEntry` (offline → the outbox), `client.rpc('update_progress')`, `reread`. `:958-975` `progressDays`.
- `data/queuedWrites.ts:27-45` `QUEUED_ACTIONS`; `:232-255` `applyWrite` for `'update_progress'` (the
  queued copy of the entry shown meanwhile). `data/outbox.ts:1-35, 96-120`: writes leave **in order**, each
  through `sync_write`, at most once per id; a refusal becomes a failure the member can read.
- `stores/reading.ts:260-269` `openProgress`, `:342-377` `confirmProgress` (sends `isoDay()`,
  `progressDays.refresh`, a 5 s Undo on Home's card), `:385-399` `undoProgress`.
- `stores/progressDays.ts` keeps each read's days in memory by session (`want`, `refresh`, `refreshAll`);
  `composables/useReadingDays.ts` derives pace, to-go, Last time, log, chart amounts from them
  (`:62-68`), `lastTime` = latest day **before today** with amount > 0 (`data/progressDays.ts:143-150`).
- `ProgressSheet.vue`: title `:92`, *Last time* line `:108-110`, the wheel (`ProgressWheel`, which already
  takes `min`/`max`), "of 480 ✎" `:187-199`, Pages \| Percent pills `:211-225` (the `.pill::after` 44 pt box
  `:320`), Finish / DNF rows `:233-260`.
- `ProgressLog.vue`: header `<h2 class="eyebrow">`, `UiRowGroup` of `UiRow`s, **14 rows** (`:14`, rows, not
  days), shown only when the read has a day (`shown === 'days'`), only for an open read
  (`pages/book/[key].vue:363`). A log row is read-only.
- The app already has the day pattern: `UiDateRow` (the layer, `@fabkho/ui`, a row with an invisible
  `<input type="date">` over it: the platform's own picker; `min`, `max`, `invalid`, 48 px) used by
  `StartSheet.vue`, `FinishSheet.vue` (`min` = the read's start, `max` = today), `EditSessionSheet.vue`;
  the words come from `useDays().relativeDay` ("Today · 3 Nov"). Danger + confirm: `EditSessionSheet.vue`
  (`UiButton tone="danger"` + `UiConfirm`), `OptionsSheet.vue` (`UiRow tone="danger"`). A section-head control:
  `UiSeeAll` (hairline pill, 32 pt drawn, 44 pt box).
- `Spark.vue` (the 21-day chart): measured on the real page at 390 px, **each column is 14.9 px wide, a bar
  14.9 px, a day without reading a 2 px dot, 2 px between**. Below the 24 px floor of WCAG 2.2 AA 2.5.8
  (docs/ACCESSIBILITY.md:149-150) and a third of the 44 pt target (`:113`).
- Profile's *Days* (`components/profile/Days.vue`, `data/stats.ts:380-440`) reads the last 42 days of
  `reading_progress_days` and `min(day)` for "since".

## 3. UI

### 3.1 Choosing the day in the sheet: five options (mock `03-day-options`)

| | Idea | For | Against |
|---|---|---|---|
| **A** Day row | `UiDateRow` "Day · Today · 3 Nov" under the Book, native picker. | The app's own pattern (Start/Finish/Edit read), zero new component, native a11y. | A 48 px row always on screen for the 1-in-10 case; "yesterday" is picker → tap → done (3 taps); the platform cannot grey out days with an entry. |
| **B** Day pills (**recommended**) | `Today · Yesterday · Pick a day…`, the third opens the native picker and then shows the day. | One tap for yesterday, any day via the picker; 32 pt pills with 44 pt boxes like Pages \| Percent; 59 + 82 + 110 pt + gaps = 259 pt fits 320 pt (360 px phone, measured); no new interaction idea. | A 44 pt row in the daily path too (lighter than A). "2 days ago" is two taps (picker). |
| **C** Week strip | Seven 44 pt day cells, dots on days with an entry, scrolls back. | Shows the log's gaps at a glance; any of 7 days in one tap. | New component, 60 pt tall, horizontal scroll inside a sheet (swipe-down conflict, the wheel already owns `data-no-swipe`), still needs a picker for older days. Too much for a rare action. |
| **D** Chart bar / log row as the entry point | Tap a bar of the 21-day chart. | No sheet control at all. | **Rejected for bars**: 14.9 px wide (measured), 2 px gap: fails 24 px, a drag target not a tap target, and "decorative on the card" (`Spark.vue:7`). **Accepted for log rows** (full-width 48 px): that is part 3 of the request. |
| **E** Quiet link | "Today · Tue 3 Nov ✎" in the dotted-underline style of "of 480 ✎". | Nothing added to the daily path. | Hidden: she forgot to update, she will not look for a dotted link; two taps to reach even "yesterday". |

**Recommended: B, plus the log's add button and tappable rows (D for rows).** B beats A on taps for the
common case and on weight; beats C on cost; beats E on discoverability. If the owner finds a permanent row
too much, E is the fallback (same sheet states).

### 3.2 The sheet, states

All states share one component and one store (`stores/reading.ts`: `progressDay: string | null`, null = today).

1. **Today** (mock 01): the sheet as it is, plus the pill row (Today lit). Everything else untouched:
   *Last time*, wheel, "of N ✎", Pages \| Percent, Finish, DNF. Saving is `update_progress` with
   `isoDay()`, exactly as now (free wheel, Undo on Home's card).
2. **Earlier day, no entry yet** (mock 02): title "Progress on Fri 30 Oct"; third pill lit with the day;
   range line replaces *Last time*; wheel opens at the **previous entry's end** (the day's "nothing yet");
   its floor is that value, its ceiling the next entry's end (`ProgressWheel` `min`/`max`); under the wheel
   "+8" against that start; effect line (below); no "of N ✎", no Finish / DNF (they end the read *today*; a
   page-count change is the Today sheet's job). Pages \| Percent stays (bounds convert).
3. **Earlier day with an entry** (mock 05, opened from a log row or by picking that day): wheel on the day's
   end, "+18" against its start, range line, **Remove this day** (danger button) at the bottom.
4. **Nothing changed** → Save just closes (the existing rule, `stores/reading.ts:354-357`).
5. **Days not loaded** (offline cold start, `useReadingDays().loaded === false`): the pill row is not
   offered (the bounds are unknown), as *Last time* is not shown then.
6. **Refusal**: stays in the sheet with `library.error.<code>` (the existing failure line), Save → "Try again".

*Effect line* (`progress.effect`, `text-caption text-ink-faint`, polite live region): says what saving does
beyond the day: "Adds Fri 30 Oct. Sat then reads +10, not +18." · "Sat 31 Oct becomes +5; Sun then reads +37." ·
"Your progress becomes p. 200." (when the edited day is the latest and the read's value follows, rule R5) ·
nothing when only this day changes. It is the one place the re-chaining is made visible.

*Add day* from the log opens state 2 on the **newest day before today without an entry** (≥ the read's
start); with none left, on yesterday (state 3). *Row tap* opens state 3 on that day.

### 3.3 The Reading log

- Head: `<h2 class="eyebrow">Reading log</h2>` left, **+ Add day** right: a hairline pill, 32 pt drawn,
  `::after` 44 pt box (the `UiSeeAll` look; the plus is the app's `plus`), `aria-haspopup="dialog"`,
  `aria-label` "Add a day to the reading log" (the visible words "Add day" are inside the name, WCAG 2.5.3).
- Rows: `UiRow as="button"` with the chevron the date rows have; name "Sat, +18 pages, ends at page 188. Edit"
  (visible text first). Pressed state = the row's existing `active:bg-fill-strong`.
- Rows with an amount ≤ 0 appear too (R12): "−6" in the faint ink, so a day that went back can be edited.
- More than 14 rows: the quiet *See all* pill pattern (`UiSeeAll dialog`) is the way to older rows; until
  then older days are still reachable by picking the date in the sheet. (PR 4 decides between *See all* and
  letting the list grow; the 14 cap predates editing.)
- The log is for the open read only, as today (`pages/book/[key].vue:363`): closed reads are R10.
- A read with a value but no day yet shows no log (`shown === 'value'`, parity.md "Progress by day"); the sheet's
  pills are the way in for it. Nothing new on the page for that case.

### 3.4 Accessibility and widths (docs/ACCESSIBILITY.md)

- **Targets**: pills 32 pt drawn with the 44 pt `::after` (the `.pill` rule, `ProgressSheet.vue:320`); Add
  day 44 pt box; log rows 48 px; Remove 48 px. Nothing under 24 px; the chart is not interactive.
- **Names**: the pill group is `role="group" aria-label="Day"` with `aria-pressed` (the Pages \| Percent
  pattern); "Pick a day…" is a `<label>`-named native `input type="date"` over the pill (`aria-label` "Pick a
  day", then the day), so VoiceOver announces the platform picker, as on the Start sheet.
- **Focus**: the sheet keeps its modal contract (`UiSheet`: focus in, kept in, given back to what opened
  it, i.e. the **row** or **Add day**). Choosing a day leaves focus on its pill; the wheel's value text
  ("p. 178 of 480") and a polite status ("Progress on Fri 30 Oct, between p. 170 and p. 188") are announced,
  because a changed dialog title is not re-read.
- **Reduce Motion / motion**: the wheel jumps to the day's value without travel; nothing animates beyond
  `UiReveal` where a line opens its room.
- **Contrast / colour**: only existing tokens; the lit pill is `bg-ink text-on-ink`; "+8" is the lamp
  colour with its sign (not colour alone); an out-of-range refusal is text.
- **360 px**: measured in the mock: the pill row is 259 pt in a 320 pt content width (no wrap, no scroll);
  the range line ("BETWEEN Fri · p. 170 and Sun · p. 188") is not clipped (checked in `parts/*-360.png`); the
  Add pill is 88 × 32. German copy is ~15 % longer: "Zwischen Fr · S. 170 und So · S. 188" fits the same line;
  "Tag wählen…" is shorter than "Pick a day…". Check again with the German pass (`e2e/i18n`).
- **200 % text**: the pill row `flex-wrap`s (PR 3 sets it; the mock does not wrap at 100 %).

### 3.5 Copy (EN / DE; keys under `book.progress.*`, errors reuse `library.error.*`)

| key | EN | DE (proposal) |
|---|---|---|
| `dayLabel` (group name) | Day | Tag |
| `dayToday` / `dayYesterday` | existing | existing |
| `dayPick` | Pick a day… | Tag wählen… |
| `titleDay` | Progress on {day} | Fortschritt am {day} |
| `rangeLabel` + `rangeLine` | Between · {from} and {to} | Zwischen · {from} und {to} |
| `rangeFrom` / `rangeOpen` | After {day} · p. 170 | Nach {day} · S. 170 |
| `effectAdd` | Adds {day}. {next} then reads {amount}, not {was}. | Fügt {day} hinzu. {next} zählt dann {amount}, nicht {was}. |
| `effectNow` | Your progress becomes {value}. | Dein Stand wird {value}. |
| `logAdd` / `logAddLabel` | Add day / Add a day to the reading log | Tag hinzufügen / Einen Tag zum Leselog hinzufügen |
| `logRowLabel` | {day}, {amount}, ends at {end}. Edit | {day}, {amount}, endet bei {end}. Bearbeiten |
| `dayRemove` | Remove this day | Diesen Tag entfernen |
| `removeDay.title/text/action/keep` | Remove {day}? · Its {n} pages move to {next}. · Remove · Keep it | {day} entfernen? · Die {n} Seiten gehen an {next}. · Entfernen · Behalten |
| `removeDay.textLatest` | Your progress goes back to {value}. | Dein Stand geht zurück auf {value}. |
| `saved` (status) | Progress saved for {day}. | Fortschritt für {day} gespeichert. |

## 4. Data rules

Notation: a read's days are rows `D = (day, start, end)`. `prev(d)` is the row with the latest day before `d`,
`next(d)` the row with the earliest day after it. `base` is the first row's `start` (none = 0, or the value
set late or imported). `P` is the read's current value; `E_L` the latest row's end. Values compare in the
wheel's unit, the other kind converted through the page count the way `valueIn` does
(`data/progressDays.ts:73-81`, mirrored in SQL by `private.progress_value_in`).

The chain invariant these rules keep: **for consecutive rows `start(next) = end(prev)`** (the first row's
start is `base`); the sum of the days' amounts is `E_L − base`. Cases that already break it (late first value,
clamped page count, mixed units) are left as they are; the new functions never make them worse and re-chain
only the one neighbour they touch.

**R1 What she enters = where she ended that day** (the wheel's own value), the day's amount is *derived*
(`end − start`, shown as "+8" under the wheel). Why: the wheel is a position (her book's page number is what
she remembers), the log already shows both, `update_progress` takes a position, and the chain is defined on
positions; an *amount* would need the previous day to be known and would break on any later correction.

**R2 One entry per day, ends only.** `(session_id, day)` stays the key. Setting a day that has a row moves
its end; its start is not an input, it is `prev`'s end (or `base`). Setting a day without a row inserts one.
The day of an existing row is **not editable** (no "change its date" in v1): to move an entry, remove it and
add it on the other day. Why: moving is a remove plus an add with two re-chains, and nobody asked for it.

**R3 Range: between the neighbours.** For day `d` the wheel may be
`lo = end(prev(d))` (else `base`, else 0) … `hi = end(next(d))`; with no `next`, `hi` = the page count (100 %),
or `P` when the read's value is not led by the days (R5). Why: it keeps every backdated day ≥ 0 and the log
monotone (an entry can never make a *later* day read "−12"), it is the only range the member can understand
from one line ("between p. 170 and p. 188"), and a typo cannot corrupt the chain. A correction lower than
`prev`'s end is made by editing `prev` first or by Remove (R6); going **back** (a re-read) is what the Today
sheet still allows without bounds, and it books "−n" on today as now. The database **clamps** a value outside
`[lo, hi]` into it and answers with what it stored (not an error): a queued write that meets neighbours
another device changed still lands (R9), and the client reads the days again after every write.

**R4 Re-chaining.** After setting `d` to `X`: `start(next(d)) := X` (in `X`'s kind), so the next day's amount
becomes `end(next) − X`; if that is 0 (`X = end(next)`) the next row is **deleted** (a day that ends where it
started has no row, the existing rule). A row inserted before the first row takes `start := base` and the
first row's start becomes `X`. If `X = lo` (the day's start) the day itself has no row (it is a Remove, R6).
Nothing else is touched.

**R5 The read's current value** (`reading_sessions.progress_*`) changes only when the days *lead* it and the
write changes the latest row. "Days lead" means: no value and no rows yet, or `P = E_L` (in the unit,
after conversion). When they lead and the edited day is (or becomes) the latest row, `P := X` (in the row's
kind, as `update_progress` stores it); when the days do not lead (an import, a clamp, a late first value:
`P ≠ E_L`) or the edited day is not the latest row, `P` is **untouched**, and for a day that would be the
latest `hi` is `P` (a past day cannot end beyond where she is now). `progress_updated_at` is not moved by a
backdated write unless it must be set (a read that had no value: `coalesce(old, now())`), because
`utils/launch.ts:24` picks the last-read Book by it. Consequence: editing a day in the middle never moves the
Book, Home's card or the buddy Section; editing the latest day moves them, and the sheet says so (effect line).

**R6 Remove = set the day to its own start.** It is the existing "ends where it started → no row" rule, so
Remove needs no semantics of its own: the row goes, `start(next) := start(removed)` so the next day absorbs
the removed day's pages (the chain stays whole), and if the removed row was the latest and the days lead
(R5), `P := start(removed)` (the read's progress goes back to where it was before that day; with `base`
none, to **none**: `progress_*` and the stamp cleared together, the table's `progress_stamped` check). The
confirm names both outcomes. Removing a day that has no row is a no-op that succeeds (idempotent, R9). A
Remove is not Undo-able in the card (the Today Undo is about a Today save); she can add the day back.

**R7 Which days.** Not before the read's `started_on` (picker `min`, database `date_invalid`) for a **new**
row; the rows already before it (the start date was edited later) stay editable and removable. Not after the
database's UTC today + 1 (the window `update_progress` already uses for every time zone, `:25-28`); the app
only offers days before `isoDay()` (Today is the Today sheet's, free of bounds). No limit on how far back
besides the start (a read of a year is a year). Why: the member's day is her own calendar day (the app sends
`YYYY-MM-DD` from `isoDay()`), the database cannot know her zone but can refuse the impossible. A write at a
zone boundary (UTC−12 … +14) is accepted the same way `update_progress` accepts it.

**R8 Units and page counts.** Exactly one of `p_page`, `p_percent` (as `update_progress`:
`progress_invalid` otherwise, page must fit the page count that counts, `progress_page_fits`, percent 0–100).
The row end is stored in the unit given; neighbours are compared in that unit after conversion; a start
rewritten by a re-chain takes the kind of the end that now precedes it. The page count is **not** an input
(no total, no `p_set_page_count`): changing it stays the Today sheet's. A lower page count (via the Today
sheet or `change_edition`) clamps the read's page but leaves rows (`clamp_session_progress`): a row's end can
sit above the page count; `hi` is `min(end(next), limit)` and the sheet shows what fits. Rounding: percent ↔
page conversions round half up like the client, so two rows can be 1 unit apart after a conversion; the
zero-amount check compares in one unit.

**R9 Idempotent and ordered.** `set_progress_day(entry, day, value)` called twice with the same value is a
no-op the second time (same end, same re-chain, same `P`). `delete_progress_day` of a missing day is a
no-op. Both lock the entry row and then the read, in `update_progress`'s order. Offline they are outbox
actions replayed in order through `sync_write` at most once per request id (§5).

**R10 Open reads only (v1).** A finished or abandoned read raises `not_reading`, like `update_progress`.
The log is shown only for the open read (`[key].vue:363`), the Finish summary uses the dates
(`readSummaryOf`) and not the rows, and no screen shows a closed read's days: editing them would be invisible.
Backdate before finishing. (Question 4.)

**R11 A read with a value but no days.** (An open read always has `started_on`,
`reading_sessions_open_has_start`.) A read with a value but **no rows** (an import) accepts a first backdated
row with `start = base = none` and `hi = P` (R5): the day then reads "+X from nothing" (the import's pages
before it are nobody's day); the member can Remove it. Documented, not prevented: the other way (refuse)
leaves the imported member with no way in.

**R12 The log and the chart show what exists.** `readingLogOf` keeps every row with `amount ≠ 0`
(negatives shown as "−6"); the chart still clamps at 0; pace and *Last time* still count only positive
amounts. Without this a day that went back is unreachable by tap.

**Chain tests of the rules** (chain of the mock, today = Tue 3 Nov, 480 pages; days ago → start→end:
11: 0→30 · 10: 30→58 · 8: 58→96 · 7: 96→120 · 5: 120→151 · 4: 151→170 · 2: 170→188 · 1: 188→212; `P` = 212):

| # | Write | Result | Rule |
|---|---|---|---|
| E1 | add 3 ago = 178 (lo 170, hi 188) | 3: 170→178 (+8); 2 becomes 178→188 (+10); `P` 212 | R3, R4 |
| E2 | edit 2 ago to 175 | 2: 170→175 (+5); 1: 175→212 (+37) | R4 |
| E3 | edit 2 ago to 212 (= `end(next)`) | 1 deleted; 2: 170→212; latest row is 2; `P` 212 | R4 |
| E4 | remove 2 ago | 1: 170→212 (+42) | R6 |
| E5 | remove 1 ago (latest, days lead) | `P` = 188, `progress_updated_at` unchanged; the Home card shows 188 | R5, R6 |
| E6 | edit 1 ago to 220 | 1: 188→220, `P` = 220 (days lead) | R5 |
| E7 | add 9 ago = 70 (lo 58, hi 96) | 9: 58→70; 8 becomes 70→96 | R3, R4 |
| E8 | add 3 ago = 100 (below `lo` 170) | clamped to 170 = `lo`: the day has no row, nothing changes | R3, R6 |
| E9 | add 13 ago (read began 12 ago) | `date_invalid` | R7 |
| E10 | read with `P` = 230 but latest row 212 (clamp / late update), add 1 day beyond the latest | `hi = 230`; `P` untouched | R5 |
| E11 | no rows, no value, add 5 ago = 40 | 5: none→40; `P` = 40 | R5, R11 |
| E12 | import: `P` = 212, no rows, add 2 ago = 200 | 2: none→200, `P` 212 untouched | R11 |
| E13 | percent unit: row 4 ends `p. 170` of 480 (35 %), add 3 ago = 36 % | converted: lo = 35, hi = 39 (188 → 39 %) | R8 |
| E14 | same write twice | second is a no-op | R9 |
| E15 | finished read | `not_reading` | R10 |

**Consumers that derive from days: what must be re-checked** (the *Re-check* column is what the PRs test):

| Consumer | Where | Effect of days appearing in the past | Re-check |
|---|---|---|---|
| Pace "A day", to go | `paceOf` `data/progressDays.ts:123-133`, `daysLeftOf` | A backdated day inside the last 14 days adds reading and, if it is the first reading day, moves the span's start earlier: the pace changes. Intended. | Vitest: pace before/after E1; a day older than 14 days does not count. |
| Last time | `lastTimeOf` `:143-150` | "latest day before today that read something": a backdated yesterday becomes Last time. Intended. | Vitest. |
| 21-day chart | `dailyAmounts` `:107-113` | Bars appear in the past; negative days stay 0. | Vitest + parity text. |
| Reading log | `readingLogOf` `:152-162`, `ProgressLog.vue:14` | R12: show `≠ 0`; the cap of 14 rows. | Vitest. |
| Home's card pace line / since line | `useReadingDays` `:62-68`, parity "Progress by day" | A read with a backdated first row flips from "Since 3 Oct · day 4" to the pace line. Intended. | e2e flow. |
| Book page "shown" | `progressShownOf` `:62-65` | Unchanged rule: any row → `'days'`; a Remove of the last row falls back to `'value'`/`'none'` (the sections close with `UiReveal`). | Vitest + the existing visibility tests. |
| Finish summary "Read in 12 days" | `readSummaryOf` `:169-173`, `FinishSheet.vue:52` | Uses `started_on` and the finish day, **not** rows: unaffected. | none (documented). |
| Update-progress *Last time* line | `ProgressSheet.vue:108` | Today mode as now; replaced by the range line in earlier mode. | component test. |
| Profile *Days* (6 weeks), "since" | `data/stats.ts:395-440`, `Days.vue` | Past dots light up, `min(day)` moves earlier, pages per day change. The record is cached on the device and refreshed after `library.touch()` (`stores/stats.ts:170`): the write must call `library.entryChanged`/`touch` even when the entry is unchanged. | Vitest on `readingDaysFromRows`; e2e: Profile after a backdated save. |
| Year in review, Records, Regal shelf | `stats.ts` year figures; `private.shelf_publish_on_session` | Use finished reads' dates, not rows: unaffected (the shelf trigger lists no progress column). Regal's own layer is private and was **not** inspected. | none. |
| Buddy Section (D2) | `buddy_refresh_entry` | See §6: only when `P` changes (R5). | pgTAP in PR 1, once #474 merges. |
| Imports | `import_books` | Sets `P`, no rows: the R5 "days do not lead" and R11 states. | pgTAP E12. |
| Reader progress | `stores/reader.ts:76` | Auto-saves today through `update_progress`: unaffected. | none. |
| Home Undo | `progressUndo`, `stores/reading.ts:320` | A backdated save that changes `P` must `forgetUndo()` (the Undo would restore a value from before it). | store test. |
| Outbox failures | `SyncFailure` | New actions' refusals use `library.error.*` (no new codes). | outbox test. |

## 5. Client design

- **Pure rules, one place** (`data/progressDays.ts`, framework-free; a native client copies it):
  `dayBoundsOf(days, day, current, pageCount, unit) → { lo, hi, start, end | null }`,
  `withDaySet(days, day, value, …)`, `withDayRemoved(days, day)`, the effect line's numbers, and the
  `readingLogOf` change (R12). The database is the authority (R3 clamps); these exist to draw the wheel's
  range, the effect line and the offline overlay. A Vitest test runs random operations through both the pure
  functions and the database and compares the resulting rows (they must agree).
- **Repository** (`data/library.ts`): `setProgressDay(entryId, day, progress)` and
  `deleteProgressDay(entryId, day)`, each as `updateProgress` does it: `queuedEntry` (offline), `rpc`,
  `isNoAnswer`, `reread`. Day is `YYYY-MM-DD`.
- **Outbox**: `QUEUED_ACTIONS += 'set_progress_day', 'delete_progress_day'` (`queuedWrites.ts:27-45`); their
  `applyWrite` cases leave the entry as it is (only the read's value can change, and only R5 says when, which
  the pure function answers from the loaded days; where the days are not loaded the entry shows no change
  until the sync). Replay is in order; each is idempotent (R9).
- **Store**: `stores/progressDays.ts` gets an overlay (`pending[session]` applied with `withDaySet`/
  `withDayRemoved` while writes wait, dropped when the real days come back) so the log shows a queued day
  at once; if that is cut for size, the log shows it after the sync and the sheet says "Saved on this
  device" (the existing offline status). `stores/reading.ts`: `progressDay`, `openProgress(entry, { day })`,
  `chooseProgressDay(day | null)`, `progressFloor`/`progressLimit`, `confirmProgress` branches on
  `progressDay` (Today: unchanged; earlier: `setProgressDay`, then `entryChanged` always, `progressDays.refresh`,
  `forgetUndo()`), `removeProgressDay()`.
- **Components**: `components/progress/DayPills.vue` (presentational, props/emits, no store), the sheet uses it;
  `ProgressLog.vue` gets the Add pill and `UiRow as="button"`; data-testids on every control
  (`progress.day`, `progress.day.today|yesterday|pick`, `progress.effect`, `progress.remove`, `book.logAdd`,
  `book.logDay`, `removeDay`), because the flows fail on a control without one (`e2e/fixtures.ts`).

## 6. Database design

**Migration**: `supabase/migrations/20261114010000_progress_day_edit.sql` (main's latest is
`20261112010000_hardcover_covers.sql`; buddy reads hold `20261113…`; `20261114…` is the first free number;
if buddy lands later numbers, take the next free one after them). After it: `pnpm schema:snapshot`, commit
the regenerated `supabase/schema-snapshot/` with it (root AGENTS.md "The database"). Never an edit of an
applied migration.

**Functions** (`public`, `security definer`, `set search_path = pg_catalog, public`, `revoke all … from public,
anon`, `grant execute … to authenticated`, as `update_progress` at `20261005102500_clear_progress.sql:153-154`):

```
public.set_progress_day(p_entry_id uuid, p_day date, p_page integer default null,
                        p_percent integer default null) returns public.reading_sessions
public.delete_progress_day(p_entry_id uuid, p_day date) returns public.reading_sessions
private.progress_value_in(p_page integer, p_percent integer, p_unit text, p_page_count integer) returns integer
private.rechain_progress_day(...)   -- the shared body of both, so Remove is "set to start"
```

`set_progress_day`, in this order (the order is `update_progress`'s, lines 29-43, so the lock order is the
one buddy D2 documents and no new cycle appears):

1. `not_signed_in` (42501); `p_day` null or after UTC today + 1 → `date_invalid` (22023).
2. Lock `library_entries` (`for update of e`) joined to its book; `entry_not_found` (P0002).
3. Lock the entry's open read; none → `not_reading` (22023).
4. Exactly one of `p_page`/`p_percent`; page fits the page count that counts; percent 0–100 → else
   `progress_invalid`.
5. If no row exists for `p_day` and `p_day < started_on` → `date_invalid`.
6. Read `prev`, `next`, `base`, `E_L`, `P` in the value's unit (R3, R5); compute `lo`, `hi`; clamp the value
   (R3); if the value = `lo` → behave as `delete_progress_day` (R6).
7. Upsert the day (`start = lo`'s stored value, `end` = the value in its kind); set `start(next)` and delete
   `next` if it ends where it starts (R4).
8. If the days lead and the day is (or becomes) the latest row: update `reading_sessions`
   (`progress_page`/`progress_percent`, other cleared; `progress_updated_at = coalesce(old, now())`) — **only
   then**, and only if the value differs, so the D2 trigger's `WHEN old distinct from new` does not fire for
   a change that leaves `P` alone.
9. Return the read.

`delete_progress_day` locks the same way, finds the row (none → return the read, no-op), sets the next day's
start to this day's start, deletes the row, applies R5/R6 to `P`.

**RLS / grants**: unchanged table grants (`select` only for members; the functions are `security definer`
and write rows the members cannot): no new policy, no table grant. The two helpers in `private` have no
execute for members (the D2 convention). Written by no other path; `update_progress` stays as it is (the
Today write: unbounded wheel, 5 s Undo, `greatest(day, max(day))`), so a Today save never has to know about
the new functions.

**`sync_write`**: one more migration-wide replacement of the whole function (`create or replace`, the
current body from `supabase/schema-snapshot/functions/public.sync_write(uuid,text,jsonb).sql` plus two
branches): `'set_progress_day'` (`p_entry_id`, `p_day`, `p_page`, `p_percent`) and `'delete_progress_day'`
(`p_entry_id`, `p_day`), **without** the `v_today - 1` clamp `update_progress` gets (an explicit past day is
the point). Hazard: another PR that also replaces `sync_write` (none of the buddy branches does: checked
`grep sync_write` on buddy-d2/d3 migrations) must be rebased on top, since the last `create or replace`
wins.

**Interaction with buddy reads D2 (PR #474, not merged; read-only here)**: its triggers follow
`reading_sessions.progress_page|progress_percent|outcome|ended_on|started_on` and refresh the member's
Section from the read's current value. Therefore:

- a backdated edit that **changes `P`** (R5: the days lead and the latest row changed, or Remove of the
  latest row) updates `reading_sessions` in the same transaction, the trigger fires, `auto_through` is
  recomputed under the room's lock, as for `update_progress`;
- a backdated edit that **leaves `P` alone** (every other case) does not touch `reading_sessions`, so no
  trigger fires and nothing is recomputed (no write at all, not even a no-op `update`);
- `reading_progress_days` is not followed by any D2 trigger and none is added: a Section is a function of
  `P`, not of when she read;
- locks: the entry row first, then the read (the order D2 relies on); the D2 note about the 40P01 cycle
  with `link_buddy_entry` applies unchanged (retryable);
- pgTAP: PR 1 asserts the above against D1/D2 tables only after #474 is on main; until then the PR carries
  the `reading_sessions` assertions (the value changes / does not change) and a TODO test file for the
  Section, added by whichever PR lands second.

**pgTAP** (`supabase/tests/progress_day_edit_test.sql`, the pattern of `reading_progress_days_test.sql`: its
`tests.member` fixtures, assertions about the rows the test made):

| Rule | Cases |
|---|---|
| auth/entry | not signed in `42501`; another member's entry `P0002`; no open read `not_reading`; finished read `not_reading` (R10) |
| input | both/neither of page, percent `progress_invalid`; page past the count; percent 101 |
| days (R7) | before `started_on` (new row) `date_invalid`; same day as an old row before the start is editable; UTC +1 ok, +2 refused; null day |
| range (R3) | E1, E7, E8 (clamp both ends), E13 (percent), clamp leaves a row when equal to `lo` |
| chain (R4) | E1–E4: `start(next)` rewritten, zero-amount next row deleted, base row insert; chain invariant holds after each (a SQL check over the read's rows) |
| `P` (R5) | E5, E6, E10, E11, E12; D2-neutral: `progress_updated_at` unchanged when `P` is untouched and when only the value changes |
| remove (R6) | E4, E5, remove of a missing day, remove of the only row of a never-tracked read clears `P` and the stamp |
| idempotence (R9) | the same call twice, via `sync_write` with one request id and with two |
| `sync_write` | both actions, an explicit day older than yesterday is **not** clamped, an unknown action `action_invalid`, replay returns `replayed: true` |
| units (R8) | a page row and a percent row neighbouring; a row above a lowered page count |
| privacy | members still have no insert/update/delete on `reading_progress_days` (the existing test) |
| interaction | `update_progress` after a backdated edit: its row starts at the (new) `P`; Undo after it |

## 7. Pull requests

Each PR lands green on its own (CI includes the i18n key checks, so a UI PR carries the keys it uses in EN
and DE; PR 5 is the review and the docs).

| # | Scope | Tests | Tier | Size |
|---|---|---|---|---|
| **1** | `20261114010000_progress_day_edit.sql` (two RPCs, helpers, `sync_write`), regenerated snapshot, `supabase/tests/progress_day_edit_test.sql`. No client change. | pgTAP (table above), `pnpm schema:snapshot` clean | **hard** (Opus `high`): the rules are the risk | L (~400 SQL, ~500 test, snapshot generated) |
| **2** | `data/progressDays.ts` pure rules + R12, `data/library.ts` (`setProgressDay`, `deleteProgressDay`), `queuedWrites.ts` (actions, `applyWrite`), `stores/progressDays.ts` overlay, `stores/reading.ts` state + `forgetUndo`, outbox. No UI. | Vitest against the stack (no mocks): repository, the random pure-vs-database comparison, outbox ordering/replay, store | normal (DeepSeek GOAT `high`) | M (~600) |
| **3** | The sheet's day switch: `DayPills.vue`, `ProgressSheet.vue` states 1–6, range line, effect line, wheel floor, copy EN/DE for it, hidden total/Finish/DNF in earlier mode. | component/Vitest, `e2e/progress-earlier-day.spec.ts` (yesterday by pill, an older day by the date input, the range, Save, Home/Profile after), axe, 360 px, German pass screenshots | normal | M (~350) |
| **4** | The log: Add day pill, tappable rows, Remove + `UiConfirm`, empty/negative rows, "See all"/older rows, copy EN/DE. | e2e (tap a row → edit; Add → newest empty day; Remove latest → card shows the lower value; offline Remove waits), axe | normal | M (~350) |
| **5** | `docs/parity.md` (Progress by day, Reading progress, sheet states, IDs, copy keys, flows), `docs/ACCESSIBILITY.md`, `docs/TESTING.md` flow line, German-pass review of the new strings, native notes (`UIDatePicker`, list rows). | docs checks | simple (Haiku) / normal | S (~200) |

**Order and parallelism.** 1 → 2 (2's tests need 1's migration: branch 2 off 1). 3 and 4 both need 2 and
share the store API fixed in §5, so they run **in parallel**, 4 rebased on 3 (4's row tap needs
`openProgress(entry, { day })`, which 3 adds; keep that function in PR 2 as a stub so neither waits). 5 last
(or each PR carries its parity lines and 5 only reviews). The mocks and the rules in this document are the
spec; PR 1's reviewer reads §4 and §6 first.

**Risks**

1. *The rules are subtle* (R3–R6). Mitigation: the chain invariant is checked in SQL after every pgTAP case,
   and the pure-vs-database random test in PR 2.
2. *`sync_write` is replaced whole*; a concurrent PR touching it conflicts silently (the last
   `create or replace` wins). Rebase and diff the function before merging.
3. *D2 interplay* (#474 not merged): an `update` of `reading_sessions` that changes nothing would still run
   the trigger's `WHEN`; PR 1 therefore writes `reading_sessions` only when `P` changes. Re-run D2's pgTAP
   after both are on main.
4. *Mixed units and rounding*: a row can start in pages and end in percent; bounds are compared in one unit
   after conversion, 1-unit slack is possible. Tested (E13).
5. *Offline overlay diverges* from the database when another device changed neighbours: the database clamps,
   the days are asked again after the sync (`refreshAll`, `stores/sync.ts:189`), the overlay is dropped.
6. *The log's 14-row cap* predates editing; older days are reachable through the sheet but not by tap
   (PR 4).
7. *Closed reads*: a member who finishes and then remembers a missed day cannot fix it (R10).
8. *Native picker*: `min`/`max` are honoured by the platform's picker (the `UiDateRow` comment says so) and
   the database checks again; the days with an entry cannot be marked in it (C solves that, at a cost).

## 8. Questions for the owner (few; each with the recommended answer)

1. **The day switch: pills (B)?** Today · Yesterday · Pick a day…. *Recommended: yes.* Fallback: the quiet
   "Today ✎" link (E) if even one row in the daily sheet is too much.
2. **May a backdated day go outside its neighbours?** Between the day before's end and the next entry's
   end (*recommended*: no, by design; a correction lower than the day before is made by editing that day or
   removing it) or free, which can make a later day read "−12"?
3. **Remove the latest day: does her progress go back?** *Recommended: yes*, to where the day started, with
   a confirm that says "Your progress goes back to p. 188" (the entries *are* her progress); the alternative
   is to keep her value and leave those pages as nobody's day. A day in the middle: its pages move to the
   next day.
4. **Finished and DNF reads: editable days?** *Recommended: not in v1* (no screen shows their days); backdate
   before finishing.

## 9. What I could not verify

- The native iOS date picker's behaviour (`min`/`max`, VoiceOver) on a device: taken from the `UiDateRow`
  documentation and the existing Start/Finish flows. VoiceOver and TalkBack were not run on the mocks.
- The mocks are the real app's DOM and CSS with the new parts injected (generator in
  `/tmp/backdate-mocks/generator/`), at 390 and 360 px in WebKit; they were not run on a phone. The week
  strip (C) and the "Today ✎" link (E) are sketches.
- Buddy reads D2 is read from the draft branch (`a4eb9835`); it may change before merging.
- Regal (private layer) was not inspected; its input is the published library file, whose trigger
  (`private.shelf_publish_on_session`) mentions no progress column.
- German strings are proposals, not reviewed by the German pass.
- The shared local stack changed under the run (another worktree's `libellus-d3` project took the ports; its
  signup mail is a link, not a code); the mocks' seed signs in with the link's token. Nothing of this repo
  was changed for it.

## 10. Execution plan and worker assignments

### 10.1 The gate

**Nothing in this section starts until the owner says "go".** The orchestrator spawns no worker, creates no
worktree and opens no PR for it before that. At "go" the orchestrator first asks the owner for a yes or a
change on questions 2–4 of §8 (assumed: bounded range; Remove of the latest day lowers her progress with a
confirm; open reads only), because W1 builds them into the database. A change to a rule is a change to §4 and
to W1's spec, made by the orchestrator in this file before W1 starts.

### 10.2 Rules for every worker

- Pi workers (`--agent pi`), one worktree and one branch each, the dev-server port that `orca_spawn` allocates.
- Read first: root `AGENTS.md` ("The database"), `web/AGENTS.md`, `CONTEXT.md`, this file (§4, §5, §6 for
  database and data work; §3 and the mocks for UI work), and the files named in the assignment.
- No mocks in Vitest (the local stack), pgTAP for database rules, targeted tests only (never `nuxi typecheck`
  or `tsc --noEmit`), `pnpm schema:snapshot` after a migration and the result committed with it, an applied
  migration is never edited, every new control has a `data-testid`, copy in EN **and** DE in the PR that uses
  it, tokens and existing components only (`UiRow`, `UiConfirm`, `UiButton`, the pill of the sheet).
- Nothing is invented: a rule that §4 does not decide is a question to the coordinator (`orca_report`
  `question`), not a guess. The rules are the owner's decisions; the code follows them.
- A commit per logical step, normal commit messages (`feat(db): …`), a PR that says which rules (R1–R12) and
  which cases (E1–E15) it covers. No GitHub issues, no Slack. The PR is opened ready for review but not merged
  by the worker.
- CI is never watched blockingly: a cheap background watcher reports; a red CI is fixed by a DeepSeek worker
  (the orchestrator's rule), not by the Opus worker.
- Report with `orca_report`: three sentences (what was done, what was found, what is left), the PR number, the
  tests that ran and their result.

### 10.3 Assignments

| Worker | Branch (base) | Model / tier | Owns (writes only here) | Done when |
|---|---|---|---|---|
| **W1 database** | `feat/progress-day-edit-db` (`origin/main`) | `anthropic/claude-opus-5-5:high` (hard) | `supabase/migrations/20261114010000_progress_day_edit.sql`, `supabase/schema-snapshot/**` (generated), `supabase/tests/progress_day_edit_test.sql` | §6 built exactly: `set_progress_day`, `delete_progress_day`, the two `private` helpers, `sync_write` replaced whole with the two branches and no day clamp, grants as `update_progress`; every row of the pgTAP table of §6 and E1–E15 pass; the chain invariant is asserted after each case; `supabase test db` green; snapshot regenerated and clean; `reading_sessions` written only when `P` changes (R5). Diff of `sync_write` against the snapshot shows only the two added branches. |
| **W2 data layer** | `feat/progress-day-edit-data` (W1's branch; retarget to `main` once W1 merges) | `command-code/deepseek/deepseek-v4.1-flash:high` (normal) | `web/app/data/progressDays.ts`, `data/library.ts`, `data/queuedWrites.ts`, `data/outbox.ts` (only if needed), `stores/progressDays.ts`, `stores/reading.ts`, `composables/useReadingDays.ts`, `web/tests/progress-day-edit*.test.ts`, existing tests it must update | The contract of §10.4 exists and is exported; R12 (`readingLogOf` keeps `≠ 0`); the random test (the pure functions against the database) agrees on at least 200 operations; the repository, outbox replay in order, idempotent replay, the offline overlay and `forgetUndo()` are covered; `pnpm test` for the touched files green. **No component, no copy.** |
| **W3 sheet** | `feat/progress-day-edit-sheet` (W2's branch) | `command-code/deepseek/deepseek-v4.1-flash:high` (normal) | `web/app/components/progress/DayPills.vue`, `components/book/ProgressSheet.vue`, EN/DE keys for §3.5 that it uses, `web/e2e/progress-earlier-day.spec.ts` | States 1–6 of §3.2 behave as the mocks 01, 02, 05 show (same classes and sizes); the third pill is a native `input type="date"` over the pill with `min` = the read's start and `max` = today; range line, effect line, wheel floor/ceiling, hidden total and Finish/DNF in earlier mode; a polite status line; the pill row wraps at 200 % text; flow green on WebKit; axe clean; screenshots at 390 and 360 px, light and dark, and German, attached to the PR. |
| **W4 log** | `feat/progress-day-edit-log` (W2's branch, rebased on W3 when W3 is in review) | `command-code/deepseek/deepseek-v4.1-flash:high` (normal) | `web/app/components/book/ProgressLog.vue`, the Remove button and `UiConfirm` (a small `components/book/RemoveDay.vue` if the sheet would grow), EN/DE keys for §3.3, additions to `progress-earlier-day.spec.ts` (a second spec file if it avoids a conflict) | Mock 04 and 05b as built; Add opens the newest day without an entry; a row tap opens the sheet on that day; negative days are listed; the older-rows rule of PR 4 is decided and written in the PR; Remove (middle: pages move on; latest: progress goes back, the card shows it); offline Remove waits; flow and axe green; screenshots as W3. |
| **W5 docs** | `docs/progress-day-edit` (`main` after W1–W4 merged) | `anthropic/claude-haiku-5-5` (simple) | `docs/parity.md`, `docs/ACCESSIBILITY.md`, `docs/TESTING.md`, `docs/i18n/**` if the German pass lists strings | "Progress by day", "Reading progress" and the sheet's section describe the shipped behaviour (rules R1–R12, IDs, copy keys, flow names, native notes: `UIDatePicker`/`DatePicker`, Material date picker, list rows); the German pass lists the new strings. Edits only text that is now untrue. |
| **R reviewer** (sub-agent, `reviewer`) | none (reads each PR) | `anthropic/claude-sonnet-5-5:high` | nothing | One review per PR against §4 (rules), §6 (database) or §3 (UI) and the project's own conventions (`project-review-router`); a list of findings the worker fixes; a second review after the fixes. |
| **CI watcher** (sub-agent, `watcher`/cheap model) | none | Haiku or the free watcher | nothing | Reports each PR's CI result to the orchestrator once; a failure goes to a DeepSeek fixer with the log. |

### 10.4 The contract W2 delivers and W3/W4 build against

Fixed here so W3 and W4 can start against stubs while W2 finishes (names may only change with the
orchestrator's say-so):

```ts
// data/library.ts (Library repository)
setProgressDay(entryId: string, day: string, progress: ProgressValue): Promise<Result<LibraryEntry>>
deleteProgressDay(entryId: string, day: string): Promise<Result<LibraryEntry>>

// data/progressDays.ts (pure)
dayBoundsOf(days, day, current, pageCount, unit): { lo: number; hi: number; start: number; end: number | null; leads: boolean }
withDaySet(days, day, value, ctx): ProgressDay[]        // the database's R3/R4, for the overlay and the effect line
withDayRemoved(days, day): ProgressDay[]
effectOf(days, day, value, ctx): { kind: 'add' | 'edit' | 'now' | 'none'; day: string; next?: { day: string; was: number; now: number }; value?: number }
newestEmptyDay(days, startedOn, today): string | null   // what "Add day" opens on
readingLogOf(...)                                         // R12: every row with amount !== 0

// stores/reading.ts
progressDay: Ref<string | null>                           // null = Today
openProgress(entry, { day?: string; total?: boolean })
chooseProgressDay(day: string | null)
progressFloor: ComputedRef<number>                        // with the existing progressLimit
progressBounds: ComputedRef<{ lo; hi; start; end; leads } | null>   // null while the days are not loaded
removeProgressDay(): Promise<LibraryEntry | null>         // after the confirm
```

Test ids W3/W4 add: `progress.day`, `progress.day.today`, `progress.day.yesterday`, `progress.day.pick`,
`progress.range`, `progress.effect`, `progress.remove`, `removeDay` (+ `.confirm`, `.cancel`), `book.logAdd`;
`book.logDay` stays and becomes a button.

### 10.5 Order, parallelism and merging

```
go ─► W1 (db, hard) ───────────────┐
        └─► W2 (data) ─┬─► W3 (sheet) ─┬─► W5 (docs)
                       └─► W4 (log) ───┘
reviewer after each PR · CI watcher per PR · W3 and W4 in parallel once W2's contract is exported
```

- W2 starts when W1 has pushed a first green migration (its tests need the functions); until then it may write
  the pure functions and their unit tests against §4's table.
- W3 and W4 start when W2 has exported the §10.4 names (stubs allowed). W4 touches `ProgressLog.vue` only and
  the sheet only through `openProgress(entry, { day })`, so the two do not edit the same file except
  `en.json`/`de.json` (each adds its own keys under its own sub-tree; rebase, never reformat the file).
- Merge order: W1 → W2 → W3 → W4 → W5, each PR green on its own. Stacked PRs are retargeted to `main` after
  their base merges. The release PR (release-please) is the orchestrator's, as always.
- Any W1 change after W2 started (a rule changed by review) is told to W2 and W3/W4 by the orchestrator in
  one message, with the diff of §4.

### 10.6 Checks before "done", whole feature (the orchestrator runs them after W4)

1. The full flow on a fresh member: start a read, three days of progress, **forget** two, add them from the
   pills (yesterday) and from the picker (a week back), edit a day from the log, Remove a middle day and the
   latest day; Home's card, the book page's figures and chart, Profile's *Days* and *since* each show the
   result (§4, consumers table).
2. Offline: the same three writes queued, replayed in order after the reconnect, the days equal the online
   run.
3. 390 and 360 px, light and dark, English and German, 200 % text, Reduce Motion, axe, VoiceOver spot check
   by the owner on a phone (the native picker, the pill group's names, the log row's name).
4. The buddy-read D2 branch, if merged by then: its pgTAP with a backdated edit that changes `P` and one that
   does not (§6, interaction).

### 10.7 Escalation

A worker asks (`orca_report` `question`) when: a rule is ambiguous; D2 or another PR changed `sync_write`,
`update_progress` or `reading_progress_days` since this plan; a test shows that two rules disagree (the plan
would then be wrong, not the test); the native picker behaves differently from §3 on the owner's device. The
orchestrator answers from this file or asks the owner. No worker widens its scope (no change to
`update_progress`, no closed-read editing, no date move) without the orchestrator's yes.

### 10.8 Cost

One Opus worker (W1) at `high`; one Sonnet review pass per PR at `high`; the rest on DeepSeek (GOAT) and Haiku.
Raise W1 to `xhigh` only if its first pgTAP run shows the chain invariant failing in more than one case.
