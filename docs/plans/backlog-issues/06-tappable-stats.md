Title: Stats: tap an author, a genre or "not rated yet" to see those books
Labels: feature, priority:high
Package: WP-06 · items #12, #16, #15, #14 (part 1) · tier P1 · size M · model Sonnet · depends on: WP-05 · wave 3
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/06-tappable-stats.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/06-tappable-stats.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
- **#12** Authors you return to: rows do nothing (`web/app/components/profile/Authors.vue:24-31`).
- **#16** Genres: a row jumps to the Library's Finished list (`pages/profile/index.vue:139-142`, `pages/profile/[year].vue:95-97`).
- **#15** Star rows already open a sheet (`components/profile/Ratings.vue:30-46`); only "{count} not yet" is plain text.
- **#14** "{count} not rated yet" under Average is plain text (`components/profile/Figures.vue:42-47`).

## Scope
- New sheet kinds in the shared books sheet (WP-05): `author`, `genre`, `unrated`, with selectors in `data/stats.ts`: `readsByAuthor`, `readsOfGenre(reads, year, ofEntry)`, `readsUnrated`.
- Author rows become buttons (keep list semantics); the sheet's top slot links to `/author/[key]` when a key is known.
- A genre row opens its sheet; "Show in Library" (`genre.stats.inLibrary`) in the sheet's foot keeps the old path.
- "N not rated yet" (Figures) and "N not yet" (Ratings) become buttons (pattern: the Pages line's `pagesMissing`) opening `unrated`.
- Keys: `profile.sheet.author`, `profile.sheet.genre`, `profile.sheet.unrated` ("Not rated yet" / "Noch nicht bewertet"), `profile.figures.unratedOpen`, `profile.ratings.notYetOpen`, `genre.stats.inLibrary`.
- `docs/parity.md`: Profile, Genres, Year in review, A member's profile.

## Acceptance criteria
- [ ] An author row opens that author's reads (on member profiles too); Back restores it.
- [ ] A genre row opens that genre's reads; Show in Library still reaches the filtered list.
- [ ] Both "not rated" lines open the unrated finished reads of the year in view (abandoned reads excluded).
- [ ] On a member who hides ratings, nothing rating-related is tappable.
- [ ] Vitest for the three selectors (re-reads, year filter, abandoned, unknown genre).

## Notes
- No migration. Member profiles have no Genres block today.
- Owner questions: author row → sheet (recommended) or → author page; keep Show in Library?
