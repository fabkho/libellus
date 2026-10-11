Title: Profile: a member's "Authors" label names her, no "in review" pill at the chart, stronger month rules
Labels: bug, priority:high
Package: WP-01 · items #1, #11a, #24 · tier P0 · size S · model Haiku · depends on: none · wave 1
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/01-profile-quick-fixes.md)" --label bug --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/01-profile-quick-fixes.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
- **#1** On another member's profile and year page the authors block says "Authors you return to" / "Autoren, zu denen du zurückkehrst" (`profile.authors.title`), as if the viewer were her. `ProfileAuthors` (`web/app/components/profile/Authors.vue:17`) has no name prop; the member pages reuse it as is (`pages/friends/[member]/index.vue:326`, `pages/friends/[member]/[year].vue:138`).
- **#11a** The owner wants no Year-in-Review link at the profile's chart. The link is the "{year} in review ›" pill beside "By month" (`pages/profile/index.vue:174-176`, and the member page `pages/friends/[member]/index.vue:312-314`), not the chart itself.
- **#24** The month rules in a year in review are a 0.5 px hairline at 10 % ink (`components/profile/MonthBooks.vue:118-120`), too faint.

## Scope
- `Authors.vue`: optional `name` prop; with it the title is `profile.authors.titleOf` ("Authors {name} returns to" / "Autoren, zu denen {name} zurückkehrt"); with a missing name a neutral `profile.authors.titleNeutral` ("Most-read authors" / "Meistgelesene Autoren"). Own profile unchanged.
- Remove the in-review pill on the own profile and (recommended) on the member profile. Year cards and, under All, the year columns still open a year. Delete `profile.inReview` from both locales if nothing uses it any more.
- `MonthBooks.vue`: `--color-hairline` → `--color-hairline-strong` (check light, dark, sepia).
- `docs/parity.md`: Profile, A member's profile, A member's year in review, Year in review.

## Acceptance criteria
- [ ] A member's profile and year page show "Authors {name} returns to" (EN) / "Autoren, zu denen {name} zurückkehrt" (DE); the own Profile still says "Authors you return to".
- [ ] With no name, the neutral title shows (never "Ein Mitglied" mid-sentence).
- [ ] No "in review" pill beside By month on the own Profile (and the member profile, if confirmed).
- [ ] Year cards and the year columns under All still open the year in review.
- [ ] The month rules are visibly stronger in light, dark and sepia.
- [ ] `pnpm test` for `i18n-parity`, `i18n-runtime-only`, `stats`, `member-profile` green; German checked at 390 px.

## Notes
- No migration, no RLS. No other "you" label leaks on member pages today (`genre.stats.row` would, but Genres is not shown there).
- Owner decisions: named or neutral label; pill on member profiles too; colour only or a 1 px rule.
- Copy must not name the app (BetterReads rename pending).
