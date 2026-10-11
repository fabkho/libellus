Title: Friends feed: more compact rows
Labels: feature, priority:high
Package: WP-04 · item #18 · tier P1 · size S–M · model Sonnet · depends on: none (owner design pick) · wave 1
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/04-compact-feed-rows.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/04-compact-feed-rows.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
A feed row is `flex items-start gap-ml py-ms` with a 72 px cover, title, author, stars and a review folded at four lines (`web/app/components/friends/FeedRow.vue:80`), so few rows fit a phone screen.

## Scope
- Two variants as screenshots in the PR (390 × 844, light and dark) for the owner to pick:
  - A: cover `sm` (40 px), title and author on one line, review clamped to two lines.
  - B: a cover between sm and md (new token), review at three lines.
- Files: `FeedRow.vue`, `FeedBatch.vue`, `RowPlaceholder.vue` (`kind="feed"`, same height as the row), `pages/friends/index.vue`, `RowActions.vue`. Home's `compact` variant stays.
- `docs/parity.md`: The feed, A batch.

## Acceptance criteria
- [ ] At least 1.5× as many rows on a 390 × 844 screen (measured before and after, in the PR).
- [ ] No layout shift when placeholders become rows.
- [ ] More still unfolds a review; the heart, Want to read and every action keep 44 px targets.
- [ ] The cover flight to the book page still lands.

## Notes
- No migration, no new strings expected. `e2e/friends.spec.ts` locally only.
- Owner questions: how compact; keep the heart and Want to read on each row?
