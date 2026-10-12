Title: Collections: a visibility switch, and her visible Collections on her profile
Labels: feature, priority:low
Package: WP-12 · items #6, #2 · tier P3 · size M–L · model Sonnet · depends on: WP-11, WP-14, WP-26 (text rule) · wave 4 · safe while invite-only; revisit before open sign-up (#331)
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/12-collection-visibility-app.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/12-collection-visibility-app.md)
Plan: docs/plans/backlog-execution.md

---
**Safe while invite-only; revisit before open sign-up (#331):** it must have its report reason (WP-25) and, for free text, WP-26's text rule before sign-up opens.

## Problem
With the model from WP-11, the member needs a switch per Collection and followers need to see her visible Collections.

## Scope
- Collection options sheet (`pages/collections/[id].vue`): "Visible to followers" switch (online only).
- A visibility mark on rows in `pages/collections/index.vue`.
- `data/collections.ts` / `stores/collections.ts`: visibility, `memberCollections`, `memberCollection`.
- `pages/friends/[member]/index.vue`: a Collections section; a read-only `pages/friends/[member]/collections/[id].vue`.
- Privacy notice (`web/app/legal/privacy.ts`, EN about :34 and DE): Collections are private unless she makes one visible to followers.
- `CONTEXT.md` (Collection); `docs/parity.md` (Collections, Collection, A member's profile, a new member Collection screen).
- Keys: `collection.visibility` ("Visible to followers" / "Für Follower sichtbar"), `collection.visibilityHint`, `collections.visible`, `member.collections`, `member.collectionsAll`.

## Acceptance criteria
- [ ] Switching a Collection on shows it on her profile to a follower; switching off removes it at once.
- [ ] Hidden Books never appear in a member's Collection.
- [ ] The switch is disabled offline with the usual note.
- [ ] The privacy notice says it, in EN and DE.
- [ ] Vitest repository tests against the local stack; `tests/member-profile.test.ts` updated.

## Notes
- Public launch (revision 2): a visible Collection's name is content strangers can see. Making a Collection visible runs its name through WP-26's `private.public_text_ok` (no URLs, no control characters); WP-25 gets a "Collection" report reason and an owner action that makes it private again. Private by default, opt-in per Collection, no bulk "make all visible".
- Edits the privacy notice: start after the BetterReads rename has merged.
- Owner questions: a page (recommended) or a sheet for her Collection; where on her profile?
