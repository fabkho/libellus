# D3 · Database: buddy read messages, reactions, delete, reports, cursors

**Repo / branch:** libellus, `feat/buddy-read-messages`. **Base:** `origin/feat/buddy-read-db` (D1, draft PR #473; **stacked**: create the branch from it, open the PR with base `feat/buddy-read-db`, retarget to `main` when #473 merges; rebase if D1 changes). **Tier:** **hard** (Opus 5.5, `high`): the one Opus slot. **Size:** L. **Depends on:** D1. **Independent of:** D2 (disjoint objects; D3 does not redefine anything D2 adds and D2 does not redefine D1's RPCs).

## Task

Add the talking: a room thread and a thread per Section, text and GIF messages, reactions (one per member), delete as a tombstone, per-thread read cursors, unread counts, and reports to the owner's feedback inbox. It ports **the behaviours Trappist paid for** (the checklist in `docs/plans/buddy-read-shared.md` part 4.5, items 1–32) onto this repository's rules: **no table grants, every read and write an RPC**, `private.blocked_either`, `auth.users` as identity. Read first: plan **part 4** (4.1 D3 tables, 4.3 the RPCs, 4.5 the checklist) and part 5.4 (the veil is the **app's**: the database gives every member every message of the read, Q8); D1's migration `supabase/migrations/20261113010000_buddy_reads.sql` (on the base branch: its header with the **advisory-lock order** and the refusal codes, `private.buddy_gate`, `buddy_host_gate`, `buddy_lock_member`, `buddy_lock_read`, `buddy_rate`, `buddy_parts`); Trappist, read only, for behaviour: `/Users/fabkho/code/trappist/supabase/schema-snapshot/functions/public.post_message(uuid,text,text,uuid,text,text,integer,integer,text,integer,smallint[],uuid,jsonb,uuid,boolean).sql`, `…/public.conversation_messages(…).sql`, `…/public.mark_read(…).sql`, `…/public.report_chat_message(uuid,text,text).sql`, `20270305120000_klipy_gifs.sql` (the GIF URL constraint), and its tests `supabase/tests/messages_test.sql`, `message_reply_test.sql`, `klipy_gifs_test.sql`. Do not copy Trappist's table-policy reads or its direct writes of reactions into a table.

## First, on the local stack

`supabase migration up` (D1's migration must be applied; the local stack may be older), then `supabase test db supabase/tests/buddy_reads_test.sql` → 196/196 on the base branch is your baseline.

## Change

1. **Migration** `supabase/migrations/20261113030000_buddy_read_messages.sql` (renumber if needed; D2 is `…020000`, D4 `…040000`; unique and ordered is enough, release applies with `--include-all`). Header: what it adds, what it leaves out, the refusal codes, and **the lock order of D1 extended** (post: caller's member lock → the read's lock → rows).
2. **Tables** (plan 4.1 D3 block; `revoke all … from anon, authenticated`, RLS on, no policies; every foreign key indexed):
   - `public.buddy_messages` (`id`, `buddy_read_id`, `section_id` null = the room, `author_id` → `auth.users` **on delete cascade**, `client_id`, `kind` in `text`,`gif`, `body` ≤ 2000, `media_url`/`media_width`/`media_height`, `reply_to` on delete set null, `spoiler`, `created_at default clock_timestamp()`, `deleted_at`, `deleted_by`, `unique (author_id, client_id)`). Constraints: a live `text` has 1–2000 characters of visible text; a `gif` has `media_url` matching `^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$` (≤ 500 chars, Trappist's pattern) and width/height 1–10000; a tombstone has `body = ''` and no media; `spoiler` only with a `section_id`; the Section belongs to the same read (enforce in the RPC; a composite check is not possible across tables, so say so). `kind = 'image'` is not allowed (X3 adds it).
   - `public.buddy_reactions` (`message_id`, `member_id`, `emoji` in ❤️ 😂 😮 😢 🔥 📚, primary key `(message_id, member_id)`: one per member).
   - `public.buddy_section_cursors` (`section_id`, `member_id`, `last_read_at`, primary key). The room's cursor is `buddy_read_members.last_read_at` (exists).
3. **New RPCs** (plan 4.3; `security definer`, `set search_path = pg_catalog, public, private`, `revoke … from public, anon`, `grant execute … to authenticated`):
   - `post_buddy_message(p_read uuid, p_section uuid, p_client_id uuid, p_kind text, p_body text, p_reply_to uuid default null, p_spoiler boolean default false, p_gif jsonb default null) returns jsonb`.
   - `buddy_read_messages(p_read uuid, p_section uuid default null, p_before timestamptz default null, p_after timestamptz default null, p_limit integer default 50) returns jsonb` (`p_section null` = the room): newest first, ≤ 100 (`before`/`after` page and catch up), each message `{id, section_id, author: {id, name}, client_id, kind, body, media_url, media_width, media_height, reply_to, spoiler, created_at, deleted_at, reactions: [{emoji, count, mine}]}`; a tombstone carries no body or URL; messages of a member blocked **either way** with the caller are left out (her own always shown); the author's `name` comes from `private.member_name` so it also works for a member who has left.
   - `react_to_buddy_message(p_message uuid, p_emoji text) returns void` (`p_emoji null` removes hers; a different emoji replaces; the same again removes).
   - `delete_buddy_message(p_message uuid) returns void` (the author, or the host any: a tombstone, reactions deleted, `deleted_by` set; again: nothing).
   - `mark_buddy_read(p_read uuid, p_section uuid, p_through timestamptz) returns void` (room or Section; cursors only move **forward**).
   - `report_buddy_message(p_message uuid, p_reason text, p_note text default null) returns void`: inserts **one** `public.feedback` row as the caller (`kind = 'report'`, `body` composed of the reason and note, at least 10 characters, `context = {buddy_read, section, message, author, excerpt}` with the excerpt cut to 300 characters and the whole context ≤ 4000 bytes). Reasons `harassment`, `spam`, `inappropriate`, `other`. Refused for her own message, a stranger, a tombstone. The feedback limiter (5 an hour, 20 a day, trigger `private.feedback_rate_limit()`) applies by itself. **A separate step in the migration** widens the check: drop and re-add `feedback_kind` with `'report'` (never edit `20261024010000_feedback.sql`); `web/app/data/feedback.ts` reads an unknown kind as `other`, so the owner screen stays safe until W4 labels it.
4. **`create or replace` of four D1 functions** (copy their **current bodies from the base branch** and change only what is listed; D2 does not touch them):
   - `public.buddy_read(uuid)`: each Section's `count` (messages not deleted, blocked pairs left out for the caller) and `unread` (after her Section cursor, not hers, not blocked) become real; add the room's `count`/`unread` as `room: {count, unread}`.
   - `public.my_buddy_reads()`: `unread` is real, summed over the room and **only the Sections she may open** (`position <= her read_through`, and the end Section when `read_through >=` the number of parts), so a count never reveals a veiled Section's activity.
   - `public.leave_buddy_read(uuid, boolean)`: `p_delete_messages` now deletes her messages in this read (and, by cascade, their reactions; replies to them become `reply_to null`) and her cursors. Without it her messages stay under her name.
   - `public.set_buddy_sections(…)`: replacing the division (anything but a rename of the same structure) is refused with `buddy_sections_locked` (PT409) once any Section thread has a message (tombstones count), because replacing deletes Sections and **cascades their messages**. A rename stays free.
5. **Helpers in `private`** (revoked from public, anon, authenticated): a per-window limiter next to D1's hourly one (`private.buddy_rate` counts per hour; reactions need 60 a minute), the block test between a message's author and the caller, the cursor and unread counters.
6. `pnpm schema:snapshot` (from `web/`) and commit `supabase/schema-snapshot/`.

## Not in it

Realtime policy and triggers (D4). Photos (`kind = 'image'`), push, the web, copy, privacy text, `docs/THIRD-PARTY.md` (K1), the owner screen's label for `report` (W4). Any change to D2's objects, to follower-facing functions or to `can_see_photo`.

## Constraints (the behaviours that cost Trappist bugs: each one a named test)

- **Order.** `created_at = greatest(clock_timestamp(), max(created_at) of this read + 1 µs)`, computed **under the read's lock**; two messages in one transaction have distinct, increasing times; a message never sorts before an earlier one. Never `now()`.
- **Idempotent send.** `unique (author_id, client_id)`; a retry with the same `client_id` returns the **same row**, inserts none, and is checked **before** the gate so a retry after a leave still answers; the same `client_id` for another read, Section or kind raises `message_client_id_reused`; `p_client_id null` raises `message_client_id_required`.
- **Locks.** Send takes D1's lock 1 (the caller's member lock) then lock 2 (the read's), and re-checks the gate **after** 2: a poster who passed the member check while the host was removing her is refused, not written after she left (**the removal race**). Reactions, deletes, cursors, reports take 2 only. Never the other order.
- **Gate and status.** Joined member only (`private.buddy_gate`, else `not_found` PT404); an **archived** read refuses new messages and reactions with `buddy_read_archived` (PT409); a **finished** read still accepts them; a Section of another read is refused (`buddy_section_invalid`, 22023).
- **Replies** stay in the same thread (same read and same `section_id`) and may not point at a tombstone (`message_reply_unavailable`).
- **Limits:** 30 messages a minute and 600 a day per member (counted from `buddy_messages` by `author_id`, `created_at`; `message_rate_limited` PT429); 60 reactions a minute; reports by the feedback limiter.
- **Blocks:** a member blocked either way with the **author** neither reads, nor reacts to, nor is shown that author's messages and reactions (both directions); nothing is removed (Trappist D6).
- The database does **not** hide Section messages from members who have not read that far (Q8: the veil is the app's); do not invent a gate. It also never puts a page, percent or fraction in any message or count.
- Account deletion: `author_id` cascades, so her messages, reactions and cursors go with `delete_my_account()`; test it.
- Keep D1's trigger `private.buddy_member_gone` and every other D1 object unchanged; the cascade from a deleted read removes its messages.

## Ownership

You own: `supabase/migrations/20261113030000_buddy_read_messages.sql`, `supabase/tests/buddy_messages_test.sql`, `supabase/schema-snapshot/**`. Do not touch `web/**`, `docs/**`, `CONTEXT.md`, D1's or D2's files, or any other migration.

## Tests (run in the PR's `check` job: `supabase test db`)

`supabase/tests/buddy_messages_test.sql`, self-contained (copy D1's helpers `tests.member`, `tests.act_as`, `tests.act_anon`, `tests.snap`, `tests.secs`). **The plan 4.5 list, items 1–32, each a named assertion** (idempotent replay, `client_id_reused`, `client_id_required`, order, 30/min and the 31st refused, 600/day, the removal race (pgTAP has one session: set up the race as the documented lock order plus a post attempted by a member whose row was deleted after the first check, as D1's tests do for its caps; say what is proven and what is only the documented order), Section of another read, reply rules and tombstone replies, archived refuses / finished accepts, GIF URL off the KLIPY hosts, `spoiler` only with a Section, a left or removed member refused; pages by `before`/`after`, blocks both directions, tombstones carry no body, a stranger gets `not_found`, a left member gets nothing; reactions one per member (replace, same again removes), refused on a tombstone and across a block, 60 a minute, non-member; delete by author, by host, by another member refused, idempotent; cursors forward only, a Section of another read refused; report: one `feedback` row of kind `report` with the context, not her own message, members only, the limiter; account deletion deletes her messages and reactions, and the unique key for others). Plus: `buddy_read()`'s real `count`/`unread` and `my_buddy_reads()`'s unread never count a veiled Section; `leave_buddy_read(…, true)` deletes only her messages; `set_buddy_sections` refuses a replacement once a Section thread has a message and allows a rename; no member can `select` any new table and `anon` cannot execute any new function. Run the **whole** suite (`supabase test db`): D1's file and every existing file stay green. Vitest, Playwright, Deno: none.

## Docs

The migration header only. No `docs/parity.md`, no privacy text (P1 already says a reported message is sent to the owner).

## Observable acceptance

- `supabase test db` green (only the known local-stack `cover_store_test.sql` failure may remain, as in PR #473: say so if it does); snapshot committed; CI's snapshot check green.
- Through PostgREST as members of one read: post in the room and in a Section, replay the same `client_id` (same row back), react, replace the reaction, delete (tombstone), page with `before`, mark read and see `unread` drop, report (one `feedback` row, visible to the owner through `feedback_list`), block one member (her messages vanish for the blocker and the blocked, both ways) — all with the documented shapes; a stranger and `anon` get `not_found` / `permission denied`.
- The PR description lists: the lock order as built, each place a D1 body was changed (the four above), and any deviation from plan part 4 with the reason.
