Title: On Hold, importers: paused shelves from Goodreads, Hardcover, Fable and Reado
Labels: feature, priority:low
Package: WP-19 · item #23 · tier P3 · size S–M · model Haiku · depends on: WP-18, PR #294 (Reado) · wave 7
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/19-on-hold-importers.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/19-on-hold-importers.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Goodreads knows only `read`, `to-read`, `currently-reading` as statuses (`web/app/data/import/goodreads.ts:80`); a custom `on-hold` or `paused` shelf becomes a Collection and an `otherShelf` note.

## Scope
- Goodreads: exclusive shelves `on-hold`, `paused`, `on hold` (owner to list names, English and German) → a paused open read.
- Hardcover (`data/import/hardcover.ts`): its Paused status, if it has one. Fable (`data/import/fable.ts`). Reado: the mapping from PR #294.
- `data/import/rows.ts`, `components/import/Counts.vue`; `import_books` if WP-17 did not already accept paused.

## Acceptance criteria
- [ ] A Goodreads file with an `on-hold` exclusive shelf imports those Books as paused, not as a Collection.
- [ ] The import page counts paused Books.
- [ ] Vitest per importer with fixture rows.

## Notes
- After PR #294 merges. Owner question: which shelf names count?
