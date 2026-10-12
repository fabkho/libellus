Title: Launch: report a member (name, photo, reviews) and the owner's minimal handling
Labels: feature, priority:high, launch
Package: WP-25 · launch (revision 2); prerequisite for #2, #4, #5, #8 · tier P0 · size M · model Sonnet (Opus review of the SQL) · depends on: none · launch wave (start now)
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/25-report-flow.md)" --label feature --label priority:high --label launch --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/25-report-flow.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
There is no way to report anything. Members can only block (`block()`, `20261017020000_social_follows.sql`) or write to the owner through the Contact sheet (`public.feedback`, kinds `bug | feature | other`, `20261024010000_feedback.sql`). After the public launch, names, photos and reviews come from strangers; a hosting service with member content needs a notice-and-action path (EU DSA Art. 16; confirm against `docs/legal-checklist.md`).

## Scope (phase 1: no wave-1 file touched)
- **Report a member:** "Report" in the member sheet's ⋯ (`web/app/components/friends/MemberSheet.vue`, reached from her profile and People). Reasons: name, photo, a review, spam, someone under 16, other; optional note ≤ 500 characters. After sending, offer **Block {name}** (existing `block()`).
- **Storage:** reuse `public.feedback` with a new kind `report` and `context = { target_member, reason, target_kind, target_id }`; it brings RLS, the rate limit (5/hour, 20/day) and the owner's inbox (`/profile/feedback`, a Reports filter).
- **Owner actions** (owner-only, `private.is_instance_owner()`): `owner_clear_member_name(member)`, `owner_remove_member_photo(member)` (objects + `accounts.avatar_path`), `owner_clear_review(session)` (text cleared, read kept); each logged (who, what, when) for the statement of reasons. Bans: Supabase dashboard, in the runbook (WP-27).
- **Phase 2 (after WP-04 changes `FeedRow.vue`):** report a single review from the feed and her profile. Later reasons arrive with WP-12 (Collection), WP-16 (bio), WP-22 (links), WP-21 (cover).
- Keys: `report.title` ("Report {name}" / "{name} melden"), `report.reason.*`, `report.note`, `report.sent` ("Thanks. The owner reads every report." / "Danke. Jede Meldung wird gelesen."), `report.block`.
- `docs/parity.md`: People / A member's profile (the sheet), Contact inbox.

## Acceptance criteria
- [ ] From any member's profile: Report → reason → Send lands in the owner's inbox with target and reason.
- [ ] The reported member never learns who reported her; other members cannot read reports.
- [ ] The owner clears a name, photo or review with one action each, and the change shows everywhere (feed, profile, reading page).
- [ ] Rate limit applies; owner functions refuse everyone else (pgTAP).
- [ ] Vitest for the repository.

## Notes
- Privacy notice coverage for reports is WP-27.
- Owner questions: owner as the only moderator; tell the member why something was removed (recommended: a short email, by hand at first); "under 16" as a reason.
