Title: Friends: follower and following counts (parked)
Labels: feature, priority:low, needs-decision
Package: WP-23 · item #19 · tier P4 · parked · size M · model Sonnet · depends on: none · revision 2: a self-only variant (S) can be done any time
Create (only when the owner says so): gh issue create --title "$(sed -n 's/^Title: //p' docs/plans/backlog-issues/23-follower-counts-parked.md)" --label feature --label priority:low --label needs-decision --body-file <(sed '1,/^---$/d' docs/plans/backlog-issues/23-follower-counts-parked.md)
Plan: docs/plans/backlog-execution.md

---
## Problem
The backlog lists a "follower system and social counts" for later. The follower system has shipped (follows, requests, private and public accounts, blocks, the follow link: `supabase/migrations/20261017010000_social_settings.sql`, `20261017020000_social_follows.sql`; People with Following / Followers / Requests, `web/app/pages/friends/people.vue`). Counts are shown nowhere, deliberately: `docs/proposals/social-v1.md:30,95`, `pages/friends/people.vue:8` ("No counts anywhere").

## If sign-up opens (#331)
- **Self-only counts (S, any time):** her own Following, Followers and Requests counts on People, from her own rows, never shown to anyone else. No new privacy surface.
- **Public counts stay parked:** on a private account they leak the size of her circle to anyone who can see her card; they invite comparison; throwaway accounts inflate them.

## Why parked
Counts invite comparison in a calm, friends-only app; the owner's own social v1 decision excluded them. Revisit when the user base grows.

## If un-parked
- Counts for herself first (People page), then on profiles only where `private.visible` allows, never for blocked members.
- An RPC (e.g. extending `my_people` / the member card), not wider RLS; pgTAP for every visibility case.

## Acceptance criteria (if un-parked)
- [ ] Counts never leak to non-followers of a private account or to blocked members (pgTAP).
- [ ] Plurals right in EN and DE.
