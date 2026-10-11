Title: Profile: tap your name to edit it
Labels: feature, priority:high
Package: WP-03 · item #3 · tier P1 · size S · model Sonnet · depends on: none · wave 1
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/03-profile-name-shortcut.md)" --label feature --label priority:high --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/03-profile-name-shortcut.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The name on the own Profile is a plain heading (`web/app/components/profile/Hero.vue:57`). Changing it means scrolling to Account → Name (`components/profile/Account.vue:162`, sheet `ShellNameSheet` at :225).

## Scope
- The name becomes a button inside the `h1` (keep `data-testid="profile.title"`), opening the same name sheet. Share the open state with the Account row (or move the sheet up to `pages/profile/index.vue`, wired like `@photo`).
- New key `profile.editName` ("Edit your name" / "Namen ändern") as the button's accessible name.
- `docs/parity.md`: Profile and Member name.

## Acceptance criteria
- [ ] Tapping the name opens the name sheet; saving updates the hero at once.
- [ ] Focus returns to the name after the sheet closes; the target is at least 44 px high.
- [ ] A member's name on her profile (`MemberHero`) is not a button.
- [ ] Offline behaves exactly like the Account row.

## Notes
- No migration (the name lives in `user_metadata.name`, `session.setName`).
- Owner question: a visible pencil beside the name, or no visual hint?
