Title: Profile: a short bio under the name
Labels: feature, priority:low
Package: WP-16 · item #4 · tier P3 · size M · model Sonnet · depends on: WP-11, WP-03, WP-12, the BetterReads rename · wave 3
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/16-profile-bio.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/16-profile-bio.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
There is no bio: `accounts` holds only id, invite code, creation time and the avatar (`20261002190000_invites_and_accounts.sql`, `20261009120000_avatars.sql`).

## Scope
- Migration: `accounts.bio text check (char_length(bio) <= 160)`; `set_bio(p_bio)` (trim, collapse whitespace, no control characters, null when blank); returned in `member_profile` and the own social JSON.
- `components/profile/Hero.vue` and `components/friends/MemberHero.vue` (between the name and "Reading here since"): plain text, no links, no markup.
- A bio sheet and an Account row; optionally a tap on the bio like WP-03.
- Privacy notice (`web/app/legal/privacy.ts`, the profile data category, EN and DE).
- Keys: `account.bio` ("Bio" / "Über mich"), `account.bioTitle`, `account.bioPlaceholder`, `account.bioCount`.
- `docs/parity.md`: Profile, A member's profile.

## Acceptance criteria
- [ ] She can set, edit and clear a bio of up to 160 characters.
- [ ] It shows as plain text under her name on her Profile and to those who may see her profile, never to blocked members.
- [ ] Deleting the account removes it.
- [ ] The privacy notice names it, in EN and DE.
- [ ] pgTAP (length, blank → null, visibility); Vitest repository.

## Notes
- No report flow exists (only block): length limit and plain text are the moderation.
- Redefines `member_profile` in full: serialize with WP-11 (if it adds a section) and WP-17.
- Owner questions: length; line breaks; who sees it (followers, or also a private account's card like the photo); the German label.
