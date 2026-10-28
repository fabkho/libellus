# WP-08 · The chart by month or by week, with a navigator — a clickable prototype

**DO NOT MERGE.** A throwaway design round for the Profile chart's Week/Month switch and range
navigator (backlog #11b/#11c). Nothing here is wired to the reading record and no production code
changed: the prototype is one dev-only page (`web/app/pages/prototype/chart-nav.vue`, the route is
dropped from every build, `web/nuxt.config.ts` `$production`) on a fake record with today pinned to
17 Jun 2026 and a first finish on 3 Sep 2024. The chart and the books sheet are the production
components (`ProfileColumns`, `ProfileReadsSheet`) on the app's tokens; the dashed mono bar on top is
prototype chrome (variant, theme, language).

Open it with `pnpm dev`, then `/prototype/chart-nav`. Query: `?variant=A|B|C|D|E&mode=months|weeks&lang=en|de`
(plus `&year=2024` or `&weeks=2025-06-23` to open on another window).

## What every variant shows

- **Months · Weeks** switch (default Months). Months: 12 columns, the year. Weeks: 13 columns (a
  quarter, ISO weeks, Monday first, by the day each read ended), the last 13 weeks to start.
- **Navigator**: previous/next with the current period label ("2026" / "23. März – 21. Juni 2026"),
  `aria-label` on both arrows, `aria-live` on the label. Months step a year, weeks a quarter.
  Both ends stop: no window before her first finish, none after today (the arrow is disabled).
  D and E draw every window at once instead (a strip, a rail), so stepping is a tap on the
  neighbour and the ends are where the strip or rail stops; their period label is `aria-live` too.
- **A bar opens that period's books** in the existing sheet ("Mai 2026", "Woche vom 16. März").
- **The figures under the chart follow the window** (Books, Pages, Average), as does the chart's
  text alternative (a visually hidden line naming every column and its count).
- Every control keeps the 44 px target, Reduce Motion is the components' own, and the whole thing
  runs at 390 and 360 px in both themes.

| Variant | Control layout | Shots |
|---|---|---|
| **A** | The segmented Months/Weeks switch above the chart, by its title; the arrows beside the period label, above the chart. | [months 390 light](shots/chart-nav-a-months-390-light.png) · [months 390 dark](shots/chart-nav-a-months-390-dark.png) · [weeks 390 dark](shots/chart-nav-a-weeks-390-dark.png) · [weeks 360 light](shots/chart-nav-a-weeks-360-light.png) · [sheet](shots/chart-nav-a-sheet-390-light.png) |
| **B** | The same switch; the arrows below the chart, and a swipe on the chart moves the window (`pan-y`, the page still scrolls). | [months 390 light](shots/chart-nav-b-months-390-light.png) · [months 390 dark](shots/chart-nav-b-months-390-dark.png) · [weeks 360 dark](shots/chart-nav-b-weeks-360-dark.png) |
| **C** | One pill ("Nach Monat · 2026 ⌄") that opens a period picker sheet: the switch on top, every period with its count, the one in view lit. No arrows. | [months 390 light](shots/chart-nav-c-months-390-light.png) · [picker months](shots/chart-nav-c-picker-390-light.png) · [picker weeks 390 dark](shots/chart-nav-c-picker-390-dark.png) · [months 360 dark](shots/chart-nav-c-months-360-dark.png) |
| **D** | **Timeline.** The switch by the title as in A; under the chart, her whole record as a strip of micro-bars (one per month or week), the window a brush framed on it. Tap a stretch of the strip or scrub along it and the chart follows live; the period label rides under the brush. Year ticks over the strip; time outside the record (before the first finish, after today) is a dotted line, today's bucket lamp-coloured. No arrows: the strip simply ends where the record does. ← → step the window from the keyboard. | [months 390 light](shots/chart-nav-d-months-390-light.png) · [weeks 390 dark](shots/chart-nav-d-weeks-390-dark.png) · [weeks 360 light](shots/chart-nav-d-weeks-360-light.png) · [earliest end 360 dark](shots/chart-nav-d-earliest-360-dark.png) |
| **E** | **Tabs and a chip rail.** The mode is two tabs in the title line ("NACH MONAT · NACH WOCHE", the active one underlined in the lamp colour) — no separate title, no segmented control. Under it one rail of chips, every period with its count ("2025 43", "KW 26–38 10"), oldest left, the one in view filled. One tap jumps anywhere. Months fit (three chips, set against the right edge); weeks scroll sideways, the year a sticky label the next year pushes out, the edges fading only where more chips hide — so the ends show as an edge that does not fade. | [months 390 light](shots/chart-nav-e-months-390-light.png) · [weeks 390 dark](shots/chart-nav-e-weeks-390-dark.png) · [weeks mid-rail 360 light](shots/chart-nav-e-weeks-360-light.png) · [a week's books 360 dark](shots/chart-nav-e-sheet-360-dark.png) |

## Recommendation: E

Round one (A–C) did not land, and the reason is the same in all three: each spends a whole row on
a control that only says one thing. A stacks two rows above the chart (title + switch, then
‹ label ›) and still only steps one window at a time, with a dead arrow at both ends; B moves the
arrows below and adds a swipe that meets iOS's back-swipe on a pushed page; C is compact but buries
the navigator behind a tap.

**E fixes that by letting the controls be the content.** The tabs *are* the title, so the mode costs
no row of its own; the chips *are* the navigator and the picker at once — every period visible, its
count on it, one tap to any of them (C's jump without the sheet, A's visibility without the arrows).
There is no disabled state to draw: the rail starts at her first window and ends at today's, and the
edge that does not fade says so. No gesture on the chart, no new chart, and it is the only layout
that scales cleanly to a custom range (WP-20 adds one chip). Two rows total above the chart, as A,
but both carry information. Its costs: in weeks only about three chips show at 360 px, so an older
quarter is a sideways scroll away (the sticky year keeps the place); the chip names weeks by number
("KW 26–38"), which matches the columns but is less human than A's date range (the sheet title and
the text alternative carry the dates). Stepping one window is tapping the neighbour chip.

**D is the most expressive and the runner-up.** The overview-plus-detail strip shows the whole record
at once — where she read a lot, where the gaps are, where the window sits in it — and the scrub feels
good; the ends are self-evident (the dotted line before the first finish). But it is a second chart
under the chart: about 100 px more, and in weeks 91 hairline bars that read as texture rather than
data at 360 px. Its scrub is a horizontal drag too, though inset 20 px from the edge and only on a
44 px strip, so it does not fight the back-swipe the way B's full-width chart did. Worth keeping in
mind for a longer history (several years on Months) or for WP-20's pages chart.

Suggested cut: **E as drawn.** If the owner wants dates rather than week numbers on the chips, label
the weeks' chips by month range ("Mär–Jun") under the sticky year; A stays the fallback.

## What the real implementation would cost (about two days)

- `data/stats.ts`: `weeksOf`/`readsInWeek` on `endedOn` (ISO weeks, Monday first through
  `utils/dates.ts`), the window model (13 weeks / a year, both ends), `readsInWindow` for the figures;
  Vitest for a week across New Year, ISO week 53, a read without an end date, DST and a non-European
  time zone. The bucketing in the prototype's page is the shape (not production code).
- `stores/stats.ts`: mode and window kept across a trip to a book; `ProfileSheet` a `week` kind plus
  its title in `useStatsSheet`/`utils/statsSheet.ts` (this is where WP-07's parallel edit to
  `ReadsSheet.vue` rows must not be disturbed — one small case, no row changes).
- `components/profile/Columns.vue` needs nothing (any columns go in; 13 already fit at 360 px).
- The chosen control as one component, the figures following the window, the text alternative,
  loading/empty/offline states, German strings (the keys this PR adds are the planned copy, EN and
  DE already in `web/i18n/locales/`), `docs/parity.md`, one local Playwright flow and screenshots.
- Member profiles: the same chart exists there today (`pages/friends/[member]/index.vue`), so the
  real change mirrors it read-only — no new member data.

## Open questions for the owner

1. The week window: 13 weeks (a quarter, as here) or 12? And does ‹ › step the whole window (as here)
   or one week at a time?
2. Remember the mode and position between visits, or always open on Months of the current year?
3. Weeks on a member's profile too (the chart is there today), and does the year pill set stay the
   outer scope (a window never crosses a picked year) or do the weeks span freely?
4. Is the copy right: "Week 12" / "KW 12" as a column name, "Week of {date}" / "Woche vom {date}" as
   the sheet title? (E reuses the same key for its chips: "KW 13–25" / "Week 13–25".)
5. E or D (see the recommendation): one tap to a named period, or a scrubbable overview of the record?

A note for the real implementation: the prototype's `earliestWeekStart()` stops one window late — it
steps back to the window holding her first finish, then returns the one after it. With this fake
record no read is lost (her September finishes fall after 23 Sep), but a first finish early in a
window would be left outside every week window. Left as is here (shared by all five variants).
