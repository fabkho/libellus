# WP-08 · The chart by month or by week, with a navigator — the chosen capsule

**DO NOT MERGE.** A throwaway design prototype for the Profile chart's Week/Month switch and range
navigator (backlog #11b/#11c). Nothing here is wired to the reading record and no production code
changed: the prototype is one dev-only page (`web/app/pages/prototype/chart-nav.vue`, the route is
dropped from every build, `web/nuxt.config.ts` `$production`) on a fake record with today pinned to
17 Jun 2026 and a first finish on 3 Sep 2024. The chart and the books sheet are the production
components (`ProfileColumns`, `ProfileReadsSheet`) on the app's tokens; the dashed mono bar on top is
prototype chrome (theme, language).

Open it with `pnpm dev`, then `/prototype/chart-nav`. Query: `?mode=months|weeks&lang=en|de`.

Seven control layouts were compared over the round (A–G; the earlier ones live in this PR's
history). The chosen one, now the only one in the prototype:

## The capsule: the mode and the navigator in one row

One pill row. The **inactive mode is a plain word** ("Monate" / "Wochen"); the **inked one is the
stepper** — ‹ the window › — so the switch and the year/week control are the same object. The weeks'
full dates ride under the chart as its caption; the capsule names the window short ("KW 13–25 · 2026"
/ "2026", across a year end "KW 52–12 · 2025/26").

- **Motion (as asked): the tab-select feel of `UiIconSegments`** (`components/ui/IconSegments.vue`,
  docs/MOTION.md `standard`). Switching modes unfolds the picked side exactly where a chosen segment
  unfolds its name: a grid column 0fr → 1fr with the fade over it, the inked surface fading in, the
  halves reflowing on `flex-grow` (1 → 2.3). The word folds away as the stepper takes its place.
  [mid-switch frame](shots/chart-nav-g-switch-midway-390-light.png).
- **Stepping** slides the window's label in from the side the window came from (`quick`), the arrows
  never moving; a swipe on the chart steps too, except within 24 px of the screen edges (iOS's
  back-swipe keeps those).
- **The ends stop**: no window before her actual first finish (taken from the data, not a nominal
  date), none after today; the arrow there is disabled and faded.
- **A bar opens that period's books** in the existing sheet ("Mai 2026" / "Woche vom 16. März").
- **The figures under the chart** (Books, Pages, Average) and the chart's text alternative follow the
  window. 44 px targets; Reduce Motion is the app's own (main.css); 390 and 360 px, light and dark,
  EN and DE.

| Shot | |
|---|---|
| Weeks, 390, light | [chart-nav-g-weeks-390-light](shots/chart-nav-g-weeks-390-light.png) |
| Weeks, 390, dark | [chart-nav-g-weeks-390-dark](shots/chart-nav-g-weeks-390-dark.png) |
| Months, 390, light | [chart-nav-g-months-390-light](shots/chart-nav-g-months-390-light.png) |
| Months, 390, dark | [chart-nav-g-months-390-dark](shots/chart-nav-g-months-390-dark.png) |
| Weeks, 360 (the tight case) | [chart-nav-g-weeks-360-light](shots/chart-nav-g-weeks-360-light.png) |
| Months, 360, dark | [chart-nav-g-months-360-dark](shots/chart-nav-g-months-360-dark.png) |
| The books sheet | [chart-nav-g-sheet-390-light](shots/chart-nav-g-sheet-390-light.png) |
| Mid-switch (the unfold) | [chart-nav-g-switch-midway-390-light](shots/chart-nav-g-switch-midway-390-light.png) |

## Why the capsule, over the others

A (switch above, arrows beside the label) and B (arrows below) spent two rows on what the capsule
says in one; C hid the navigator behind a tap; D (a scrubbable mini-timeline) was the most expressive
but read as a second chart — 91 weekly bars of noise at 360 px; E (tabs + chip rail) was the runner-up
and still wins for a very long record or a custom range, since every period is one tap. The capsule
keeps the navigator visible and the whole control to one 44 px row, and the inked-half-as-stepper
gives the mode switch its motion for free (the ink surface is the thing that moves).

## What the real implementation would cost (about two days)

- `data/stats.ts`: `weeksOf`/`readsInWeek` on `endedOn` (ISO weeks, Monday first through
  `utils/dates.ts`), the window model (13 weeks / a year, both ends, the left end from the first
  finish in the data), `readsInWindow` for the figures; Vitest for a week across New Year, ISO week
  53, a read without an end date, DST and a non-European time zone. The prototype's bucketing is the
  shape (not production code).
- `stores/stats.ts`: mode and window kept across a trip to a book; `ProfileSheet` a `week` kind plus
  its title in `useStatsSheet`/`utils/statsSheet.ts` (one small case, keeping clear of WP-07's
  parallel `ReadsSheet.vue` row work — no row changes here).
- `components/profile/Columns.vue` needs nothing (any columns go in; 13 already fit at 360 px).
- The capsule as one component (the fold/unfold is `UiIconSegments`' own technique), the label slide
  on step, the swipe with the edge guard, the caption, loading/empty/offline states, the German
  strings (the keys this PR adds are the planned copy, EN and DE in `web/i18n/locales/`),
  `docs/parity.md`, one local Playwright flow, screenshots.
- Member profiles: the same chart exists there today (`pages/friends/[member]/index.vue`), so the
  real change mirrors it read-only.

## Open questions for the owner

1. The week window: 13 weeks (a quarter, as here) or 12? And does ‹ › step the whole window (as here)
   or one week at a time?
2. The capsule names weeks "KW 13–25 · 2026" and the caption tells the dates — right division, or
   should the capsule carry the dates and the caption go?
3. Remember the mode and position between visits, or always open on Months of the current year?
4. Weeks on a member's profile too, and does a picked year still scope the windows (a window never
   crosses a picked year) or do the weeks span freely?
