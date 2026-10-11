Title: Stats: rate books straight from the "not rated yet" sheet
Labels: feature, priority:high
Package: WP-07 · item #14 (part 2) · tier P2 · size M · model Sonnet · depends on: WP-06 · wave 4
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/07-rate-from-sheet.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/07-rate-from-sheet.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The unrated sheet (WP-06) lists the reads without a rating, but rating one means opening each book's history. `UiRatingInput` exists (`FinishSheet`, `EditSessionSheet`), but saving takes a full `SessionEdit` (`stores/history.ts:143` → `data/library.ts:1005`).

## Scope
- A rating control per row in the unrated sheet (row action slot from WP-05).
- A rating-only write (`rateSession(entryId, sessionId, rating)`) reusing the `updateSession` path and the offline outbox.
- A rated row stays until the sheet closes, marked as rated; the figures refresh after.
- Keys: `profile.sheet.rateLabel` ("Rate {title}"), `profile.sheet.rated`.

## Acceptance criteria
- [ ] Rate three books in a row without leaving the sheet.
- [ ] Nothing jumps under the finger while rating; rated rows show their stars.
- [ ] Offline, ratings queue and sync later.
- [ ] Average and the not-rated counts are right after closing.
- [ ] Every rating control is named by its book.
- [ ] Vitest repository test against the local stack.

## Notes
- No migration expected; confirm `update_session` accepts a rating-only change under `rating_when_finished`.
- Owner questions: inline stars or a tap that opens a small rating sheet; rating only (recommended) or a review too?
