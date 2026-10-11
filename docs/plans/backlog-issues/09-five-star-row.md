Title: Year in review: every five-star book of the year, not one favourite
Labels: feature, priority:high
Package: WP-09 · item #25 · tier P2 · size M · model Sonnet · depends on: WP-01 · wave 2
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/09-five-star-row.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/09-five-star-row.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
A year in review shows one favourite: the highest-rated read, newest on a tie (`web/app/data/stats.ts:298`), as one lit card (`components/profile/Favourite.vue`).

## Scope
- `data/stats.ts`: `favourites` = the year's reads rated exactly 5.00 (20 quarters; the Ratings block counts 4.75 as four, `starOf` :72), newest first; with none, today's single favourite.
- `Favourite.vue`: a sideways row of covers lit by the first, each a link named by its title; a loading skeleton.
- Both year pages: `pages/profile/[year].vue`, `pages/friends/[member]/[year].vue` (Manual books of a member open nothing). `YearCards.vue` keeps one favourite.
- Key: `profile.year.favourites` ("Five stars" / "Fünf Sterne") with the count.

## Acceptance criteria
- [ ] A year with four 5.00 reads shows four covers in one row.
- [ ] A year with none shows the top-rated read as today.
- [ ] 4.75 reads are not in the row.
- [ ] The `#favourite` anchor still works; the ambient light still comes from a cover.
- [ ] Vitest for `favourites` (exclusion of 4.75, order, fallback).

## Notes
- No migration. Owner questions: exactly 5.00 or ≥ 4.75; sideways row or wrapped grid; the title.
