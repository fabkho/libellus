Title: Profile: pages read across all books, by week, month or a custom range
Labels: feature, priority:low
Package: WP-20 · item #13 · tier P3 · size L · model Sonnet · depends on: WP-08 · wave 5
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/20-pages-read-chart.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/20-pages-read-chart.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Reading days (`web/app/components/profile/Days.vue`) show five weeks of dots; `reading_progress_days` has per-day pages, but the stats record loads only 42 days (`DAYS_SHOWN`, `data/stats.ts:69`). There is no chart of pages over a chosen range.

## Scope
- `progressDaysIn(from, to)` in `data/stats.ts`: paginated, loaded lazily (not inside `record()`).
- New `components/profile/PagesChart.vue` reusing WP-08's ranges and `Columns.vue`; week, month and a custom range (capped at 366 days).
- Own Profile only.
- Keys: `profile.pagesChart.*` ("Pages read" / "Gelesene Seiten", range labels).

## Acceptance criteria
- [ ] Week, month and custom ranges show pages per day; percent-only Books counted as `amountOf` does.
- [ ] Never shown on a member's profile.
- [ ] No streaks, goals or sentences.
- [ ] Data loads only when the chart is opened.
- [ ] Vitest for the aggregation.

## Notes
- No migration. Owner questions: where on the Profile; the custom range's maximum?
