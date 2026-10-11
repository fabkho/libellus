Title: Stats: one paginated books sheet for every figure
Labels: refactor, priority:high
Package: WP-05 · item #17 (+ the base for #12, #14, #15, #16) · tier P1 · size M · model Sonnet · depends on: WP-01 · wave 2
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/05-stats-books-sheet.md)" --label refactor --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/05-stats-books-sheet.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
- `ProfileReadsSheet` renders every read at once (`web/app/components/profile/ReadsSheet.vue:24`); a sheet of a few hundred reads is one long DOM list (#17).
- The `ProfileSheet` union (`stores/stats.ts:7-11`) is switched over in four pages, each with its own `sheetTitle`/`sheetReads`: `pages/profile/index.vue:111-142`, `pages/profile/[year].vue`, `pages/friends/[member]/index.vue`, `pages/friends/[member]/[year].vue`. Every new tappable figure (#12, #14, #15, #16) would add to four copies.

## Scope
- New `composables/useStatsSheet.ts`: maps a `ProfileSheet` to `{ title, reads, withYear }`; the four pages use it.
- `ReadsSheet.vue`: show 30 rows, then a **Show more** button that adds 30 (`profile.sheet.showMore`: "Show {count} more" / "{count} weitere anzeigen").
- `stats.keptSheet` gains `shown`; `useSheetRestore` restores count and scroll on Back.
- A per-row action slot (used later by the inline rating).
- Check `components/home/TallySheet.vue`, which also uses `ProfileReadsSheet`.

## Acceptance criteria
- [ ] A sheet of 120 reads shows 30 rows; Show more adds 30 each time.
- [ ] Open a book from row 45, come Back: the sheet is open with the same rows shown and the same scroll.
- [ ] None of the four pages has its own sheet title/reads switch.
- [ ] Sheets under 30 rows look and behave exactly as before.
- [ ] Vitest for the mapping and the paging helper.

## Notes
- Render-only pagination: all closed reads are already on the device (`stats.record.reads`). No RPC, no migration.
- Owner questions: page size (25/30/50); button or auto-load near the end?
