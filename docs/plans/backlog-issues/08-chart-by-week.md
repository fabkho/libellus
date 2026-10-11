Title: Profile chart: by month or by week, with a range navigator
Labels: feature, priority:high
Package: WP-08 · items #11b, #11c · tier P2 · size M · model Sonnet · depends on: WP-06 · wave 4
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/08-chart-by-week.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/08-chart-by-week.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The chart is By year (All) or By month (a year) (`web/app/components/profile/Columns.vue`); there is no weekly view and no way to step through ranges. `data/stats.ts` has no weekly bucketing.

## Scope (recommended shape, owner to confirm)
- With a year picked: a compact segmented control "Months · Weeks" by the chart title.
- Weeks: 13 columns (a quarter), ‹ › stepping through the year; Months: 12 columns, ‹ › stepping years in step with the pills.
- Under All: years only, no toggle.
- `weeksOf(reads, …)` in `data/stats.ts` (ISO weeks, Monday first like `Days.vue`, by `endedOn`); mode and offset in `stores/stats.ts` (survive a trip to a book); a `week` sheet kind.
- Keys: `profile.byWeek` ("By week" / "Nach Woche"), `profile.chartMode.*`, `profile.prevRange`, `profile.nextRange`, `profile.sheet.week`.

## Acceptance criteria
- [ ] Toggling changes only the bars; nothing below the chart moves.
- [ ] ‹ › move through ranges and stop at the first and last.
- [ ] A week's column opens that week's reads; Back restores it.
- [ ] Mode and position survive opening a book and coming back.
- [ ] Every control has an accessible name.
- [ ] Vitest for `weeksOf` (a week across New Year, week 53, a read without an end date).

## Notes
- No migration. Shares the range model with the pages-read chart (WP-20).
- Owner questions: which week range; on member profiles too; remember the mode?
