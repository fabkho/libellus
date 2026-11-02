# D1 · Database: buddy reads, members and Sections

**Repo / branch:** libellus, `feat/buddy-read-db` off `origin/main`. **Tier:** hard (Opus 5.5, `high`). **Size:** L. **Depends on:** nothing. **Port:** none (database only; no web code, no copy).

## Task

Add the database for **buddy reads**: one Book read together by 2–12 Members in a *room*, divided into *Sections*. This PR is the core: rooms, members, Sections, invitations, the invite link, leaving, the host. It does **not** include messages, the progress → Section function or the Realtime topics (later PRs D3, D2, D4). Read first: `docs/plans/buddy-read-shared.md` parts 4 and 5, `AGENTS.md` ("The database"), `web/AGENTS.md`, `supabase/migrations/20261017020000_social_follows.sql` and `20261019020000_social_http_codes.sql` (the house style for RPCs, refusals and limits), `supabase/schema-snapshot/functions/public.follow(uuid).sql`, `public.follow_target(text).sql`, `private.blocked_either`, `private.reachable`, `private.can_see_photo`, `public.can_see_member_file(text)`.

## Change

1. **Migration** `supabase/migrations/20261113010000_buddy_reads.sql` (renumber after the latest on `origin/main` if it moved; the latest today is `20261112010000_hardcover_covers.sql`). A header comment says what it does and what it leaves out. Tables, exactly as in plan part 4.1 (D1 block): `public.buddy_reads`, `public.buddy_read_members` (with `auto_through`, `hand_through`, the generated `read_through`), `public.buddy_read_sections`, `private.buddy_calls`. Every new table: `enable row level security`, **no policies**, `revoke all on public.<table> from anon, authenticated` (the default privileges grant everything, so the revoke is explicit); every foreign key indexed.
2. **RPCs** (plan part 4.3), all `security definer`, `set search_path = pg_catalog, public, private`, `revoke all … from public, anon`, `grant execute … to authenticated`; `not_signed_in` 42501; refusals as stable messages with `PT404` (`not_found`), `PT403` (`not_host`), `PT429` (`rate_limited`, `buddy_read_limit`), `22023` for invalid input: `create_buddy_read`, `my_buddy_reads`, `buddy_read`, `invite_to_buddy_read`, `buddy_read_link`, `buddy_read_target`, `join_buddy_read`, `answer_buddy_invite`, `leave_buddy_read`, `remove_from_buddy_read`, `finish_buddy_read`, `archive_buddy_read`, `set_buddy_sections`, `link_buddy_entry`, `set_buddy_hand`. `buddy_read()` returns each member's `where` as `section k` / `end` / `not set` computed from the stored `read_through` and `entry_id`/`hand_through` (plan 5.5) and never a page, percent, fraction, date, outcome, entry id or source. Nothing writes `auto_through` yet (D2): leave it null; `set_buddy_hand` works.
3. **Rules to implement as the plan says:** a read is for a **Catalogue Book** (`books.source <> 'manual'`) the host holds in her Library (her member row links that entry); Sections come from the client as a jsonb list `[{kind, label, start_page, end_page, to_fraction}]`, validated server-side (ordered, contiguous, 1–100 `part` + exactly one `end` with `to_fraction = 1`, labels 1–120); one **active** read per host and Book; at most 10 active reads per member; cap **12** members counting pending invites, under the read's advisory lock; invites only for people she **follows** (accepted) and who are not blocked either way (`private.blocked_either`); the link token is `private.reading_page_token()` (22 chars, 128 bits); `buddy_read_target(token)` returns **the same `null`** for a wrong, off, renewed, ended, full or blocked-with-any-member token; `join_buddy_read` refuses as `not_found` when she is blocked with any member; idempotent create (`unique (host_id, client_id)`), idempotent join. Rate limits in `private.buddy_calls`: 20 an hour for `create` and `invite`, 30 an hour for `join` (the `private.follow_calls` pattern: purge old rows, count, insert, under a per-member advisory lock).
4. **Trigger** `private.buddy_member_gone()` after delete on `buddy_read_members`: if the host row went, the earliest-joined remaining member becomes host (`role`, `buddy_reads.host_id`); if nobody is left, delete the read.
5. **Co-member visibility:** `private.buddy_co_members(a, b)` (both joined in one read, no block) and `private.can_see_photo(caller, owner)` extended with `or private.buddy_co_members(caller, owner)`. Check `public.can_see_member_folder` / `can_see_member_file` (the avatar storage policy) read the same and need no more than that.
6. **`pnpm schema:snapshot`** (from `web/`, local stack up and migrated) and commit the regenerated `supabase/schema-snapshot/`. CI fails on a stale one.
7. **`CONTEXT.md`:** add the terms *Buddy read*, *Host*, *Section*, *Position (where she is)*. Definition of Position: "the Section a Member is in, worked out from her progress or set by her; the only thing about her progress that leaves her account, and only to the members of a Buddy read she joined, while she is in it."

## Not in it

Messages, reactions, reports, cursors (D3). Realtime policy and triggers (D4). Any use of `reading_sessions` progress (D2). Any web code, i18n, copy, README, privacy text (P1/W-PRs). Photos, push, GIFs.

## Constraints

- **Never edit an applied migration.** Only add the new file. No `drop` of anything existing; the only existing function you change is `private.can_see_photo`, by `create or replace` in the new migration.
- No table grants to `anon`/`authenticated`; every read and write is an RPC that first proves she is a **joined** member; a stranger always gets `not_found`, never "forbidden", so existence is not revealed.
- Follower-facing functions (`member_card`, `member_profile`, the feed, `both_read`, the reading page functions) must stay unchanged and keep returning **no progress**.
- Locks: document the advisory-lock order in the header (sender/member → read); two joins at once must not pass the cap of 12.
- Pin `search_path` on every function; no `now()` ordering where order matters; use `clock_timestamp()` for `created_at` defaults.
- Do not guess Trappist's SQL: this repo's rules differ (no table reads, no direct writes). `trappist:supabase/schema-snapshot/` is a reference for *behaviour* only.

## Ownership

You own: `supabase/migrations/20261113010000_buddy_reads.sql`, `supabase/tests/buddy_reads_test.sql`, `supabase/schema-snapshot/**`, `CONTEXT.md`. Do not touch `web/**`, `README.md`, `docs/**` (except `CONTEXT.md`), or any other migration.

## Tests (run in the PR's `check` job: `supabase test db`)

`supabase/tests/buddy_reads_test.sql`, acting as real signed-in members (`tests.member(...)` as in `social_follows_test.sql`); assertions ask about rows this test made, never table counts. Cover plan 4.5 items 33–45 and these: create shape, Catalogue-only, Library required, idempotent, Sections validation errors, one active read per host and Book, 10-read limit, invites (followed and unblocked only; cap 12 counting pending; a skipped person is reported, not an error), link on/off/renew, `buddy_read_target` identical `null` for each bad case, join (idempotent, blocked-with-any-member → `not_found`, cap), answer invite, leave (host handover to earliest joiner; last leaves → read deleted), remove (host only), finish/archive (host only), no member can `select` any new table, `anon` has no `execute`, account deletion (`delete_my_account`) cascades and hands the host role on, co-members see each other's photo and not after leaving or when blocked, rate limits (`PT429`), and a regression assertion that the follower-facing functions still return no progress. Vitest, Playwright, Deno: none.

## Docs

The migration header; `CONTEXT.md`. No `docs/parity.md` (no screen), no privacy text (P1).

## Observable acceptance

- `supabase test db` green with the new file; `pnpm schema:snapshot` committed; CI's snapshot check green.
- From `psql` as an authenticated member: every RPC answers the shape in plan 4.3; `select * from public.buddy_reads` fails with permission denied.
- A host creates a read for a Library Book, invites a followed member, turns the link on; a third member joins by token; the cap, the block and the wrong-token cases behave as listed; `buddy_read(id)` lists members with `where` and **no** page/percent/date.
- Report in the PR: the advisory-lock order, anything in plan part 4 you changed and why.
