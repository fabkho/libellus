Title: Collections: one visibility model in the database (private by default, visible to followers by choice)
Labels: feature, priority:low
Package: WP-11 · items #6, #2 · tier P3 · size L · model Opus · depends on: none (head of the SQL chain) · wave 1 (filler)
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/11-collection-visibility-db.md)" --label feature --label priority:low --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/11-collection-visibility-db.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
Every Collection is private: `collections` has no visibility column and RLS is owner-only (`supabase/migrations/20261003110515_collections.sql:23-35, 96-100`). #2 (show her Collections on her profile) and #6 (hide single Collections) need one model.

## Scope
- Migration: `collections.visibility text not null default 'private' check (visibility in ('private','followers'))`; existing rows private.
- `set_collection_visibility(p_collection, p_visibility)`: online only (social writes are never queued), so no `sync_write` change.
- `member_collections(p_member)` and `member_collection(p_member, p_collection, p_after, p_limit)`: security definer, `set search_path = ''`, gated by `private.visible(auth.uid(), p_member)`, entries filtered `not e.hidden`, counts of visible entries only, blocks respected.
- Table RLS unchanged.
- pgTAP: `supabase/tests/collection_visibility_test.sql`.

## Acceptance criteria
- [ ] Private Collections are invisible to everyone but the owner.
- [ ] 'followers' Collections are visible to accepted followers and on public accounts; invisible to requesters, blocked members (both ways) and strangers to a private account.
- [ ] Hidden-from-followers entries are never listed or counted.
- [ ] Another member's id gives `collection_missing`; pagination works.
- [ ] Existing Collections are private after the migration; the lints test passes.

## Notes
- New migration after the latest on main at the time (now `20261026020000_collections_updated_at.sql`).
- If a Privacy section switch is chosen, this touches `private.my_social_json`, `set_social_sections` and `member_profile` (full-body redefinitions; serialize with WP-16 and WP-17).
- Owner questions: private by default; a section switch too; ever on the public reading page?
