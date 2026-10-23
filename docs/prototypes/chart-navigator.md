# WP-08 · The chart by month or by week, with a navigator — a clickable prototype

**DO NOT MERGE.** A throwaway design round for the Profile chart's Week/Month switch and range
navigator (backlog #11b/#11c). Nothing here is wired to the reading record and no production code
changed: the prototype is one dev-only page (`web/app/pages/prototype/chart-nav.vue`, the route is
dropped from every build, `web/nuxt.config.ts` `$production`) on a fake record with today pinned to
17 Jun 2026 and a first finish on 3 Sep 2024. The chart and the books sheet are the production
components (`ProfileColumns`, `ProfileReadsSheet`) on the app's tokens; the dashed mono bar on top is
prototype chrome (variant, theme, language).

Open it with `pnpm dev`, then `/prototype/chart-nav`. Query: `?variant=A|B|C&mode=months|weeks&lang=en|de`.

## What every variant shows

- **Months · Weeks** switch (default Months). Months: 12 columns, the year. Weeks: 13 columns (a
  quarter, ISO weeks, Monday first, by the day each read ended), the last 13 weeks to start.
- **Navigator**: previous/next with the current period label ("2026" / "23. März – 21. Juni 2026"),
  `aria-label` on both arrows, `aria-live` on the label. Months step a year, weeks a quarter.
  Both ends stop: no window before her first finish, none after today (the arrow is disabled).
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

## Recommendation: A, with the label opening C's picker

A keeps the whole model in one row — mode, period, direction — above the chart where the year pills
already sit, so nothing new is below the chart and the figures' move is the only thing that changes
between modes. B's swipe is tempting but the Profile is a pushed page: a horizontal drag on a
full-width chart meets iOS's back-swipe at the left edge, and its arrows-below row repeats the label
A carries anyway. C is the most compact and the only one that scales to a custom range (WP-20's
pages chart wants one), but hiding the arrows behind a tap buries the navigator this issue is about.
Suggested cut: **A as drawn, the period label tappable to open C's picker as a jump**, swipe left out.

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
   the sheet title?
