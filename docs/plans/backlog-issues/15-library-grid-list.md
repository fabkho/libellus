Title: Library: grid or list, with each status's date line
Labels: feature, priority:low
Package: WP-15 · items #20, #21 · tier P3 · size L · model Sonnet · depends on: WP-10 · wave 2
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/15-library-grid-list.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/15-library-grid-list.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The Library's Want to read and Finished lists are rows only (`web/app/pages/library.vue`); the view kept per status (`data/libraryView.ts`, key `libellus-library-view`) has no layout. #21: rows already show each status's date ("Added {date}", the end day, "DNF · {date}"; Currently reading cards show "Since {date} · day {n}"), so only a grid needs them.

## Scope
- `ListView.layout: 'list' | 'grid'` (back-compatible parse of stored JSON); a toggle in `ViewBar.vue` (`aria-pressed`).
- New `components/library/GridCell.vue`: cover plus one date line per status.
- Want to read and Finished (Finished keeps its sticky years); not Currently reading.
- Keys: `library.view.layout.list` ("List" / "Liste"), `library.view.layout.grid` ("Grid" / "Raster").
- `docs/parity.md`: Library, Library filters and sort.

## Acceptance criteria
- [ ] The toggle on Want to read and Finished, kept per status on the device; none on Currently reading.
- [ ] Three columns at 390 px; each cell keeps its date line.
- [ ] Covers lazy-load (first eight eager); the cover flight works from a cell.
- [ ] Vitest: `listViewFromJson` reads old stored JSON.

## Notes
- No migration. Collection page grid left for later (drag reorder stays a list).
- Owner questions: per status or one layout; the Collection page too; a date or a duration ("for 12 days")?
