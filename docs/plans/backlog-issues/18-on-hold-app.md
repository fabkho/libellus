Title: On Hold, app: pause and resume a book, and every screen that shows a status
Labels: feature, priority:low
Package: WP-18 · item #23 · tier P3 · size L · model Sonnet (Opus review) · depends on: WP-17, WP-15 · wave 5
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/18-on-hold-app.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/18-on-hold-app.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
With the paused status from WP-17, every place in the app that knows a status needs it (list in `docs/plans/backlog-execution.md` §4.4).

## Scope (recommended UI)
- Paused Books as a quiet section at the end of the Currently reading segment (a fourth segment does not fit 390 px in German).
- Pause in the book's ⋯ (`components/book/OptionsSheet.vue`); Resume where Update progress is; "Paused since {date}".
- Types and lists (`data/library.ts`, `stores/library.ts`, `data/deviceLibrary.ts`; an unknown status never breaks the device copy), Library view (`data/libraryView.ts`), book page, Home, search badge, Collection rows, stats head counts (`data/stats.ts:339-340`), offline queue (`data/queuedWrites.ts`), friends utils, shelf (`data/memberShelf.ts:36`), Regal export (`data/export/regal.ts`).
- Keys: `status.paused` ("On hold" / "Pausiert"), `book.pause` ("Pause" / "Pausieren"), `book.resume` ("Resume" / "Weiterlesen"), `book.pausedSince`, `library.paused`, `sync.action.pause`, `sync.action.resume`.
- `CONTEXT.md` (Status, Reading session, On hold); `docs/parity.md` (Search, Book, Add sheet, Status part, Start sheet, Library).

## Acceptance criteria
- [ ] Pause and Resume from the book page, offline too.
- [ ] Paused Books leave Home's Currently reading and stay findable in the Library.
- [ ] Search shows "On hold" / "Pausiert".
- [ ] An unknown status in the device copy never breaks an older app.
- [ ] Vitest for the device copy, the offline queue and the stats counts.

## Notes
- Ship the tolerant device-copy read in a release before pausing is possible (see WP-17).
- Owner questions: section or segment; counted in the Profile's Library line; on the shelf?
