Title: Launch week: name rules on the server and a shared text rule for public content
Labels: feature, priority:high, launch
Package: WP-26 · launch (revision 2); guard for #3, prerequisite for #2, #4, #5 · tier P1 · size M · model Sonnet (Opus review: an auth.users trigger) · depends on: WP-03 · wave 2
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/26-name-and-text-rules.md)" --label feature --label priority:high --label launch --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/26-name-and-text-rules.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
A display name is free text in `user_metadata.name`, written through the public auth API (`auth.updateUser`). The client's `cleanName` trims and caps at 40 (`web/app/data/auth.ts:58-61`); the server only does `left(btrim(name), 40)` on read (`private.member_name`, `20261017010000_social_settings.sql:258-265`). After the public launch anyone can call herself the app's name, "Support" or the owner, or use bidi/zero-width/control characters or a URL. Bio (WP-16), visible Collection names (WP-12) and links (WP-22) need the same rule.

## Scope
- `private.public_text_ok(text, max_len, allow_urls)`: trim and collapse whitespace; refuse control, bidi-override and zero-width characters; refuse URLs, e-mail addresses and phone-number patterns unless allowed; length.
- A `BEFORE UPDATE OF raw_user_meta_data` trigger on `auth.users` that refuses a **changed** name breaking the rule or matching a reserved list (Libellus, BetterReads, admin, support, team, moderator, official, the owner's name; case- and accent-folded). Only when the name changes, so sign-ins (which also update `auth.users`) never fail on legacy names.
- `private.member_name` sanitizes on read as well.
- Client: `cleanName` mirrors the rule; the name sheet shows `account.nameError.reserved` ("This name is reserved." / "Dieser Name ist reserviert.") and `account.nameError.invalid`. WP-03's shortcut uses the same sheet.
- No profanity list (false positives in two languages); reports (WP-25) handle the rest.

## Acceptance criteria
- [ ] "BetterReads Support" or a name containing U+202E is refused through the app and through a direct `auth.updateUser`.
- [ ] Existing members with any name still sign in.
- [ ] Old names display sanitized.
- [ ] pgTAP for the helper (EN and DE examples) and the trigger; Vitest for `cleanName`.

## Notes
- Serialize the migration with WP-24 (both around `auth.users` triggers).
- Owner questions: the reserved list; unique names (recommended: no).
