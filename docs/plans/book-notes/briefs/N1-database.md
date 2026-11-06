# N1: the Notes base in the database

**Read first:** the plan [`docs/plans/book-notes.md`](../../book-notes.md), parts 1.3, 2 (all of it: chapters, visibility,
replies, the switch, the chapter rule), 4, 5.1 and 8 (decisions). The PR shape, the throwaway stack and what must not be
touched: [README.md](README.md). Model: Opus, high. The coordinator runs an independent security review before merge.

## Goal

One forward migration (or two, split at a natural line) that adds the Notes base to the **live** database, with every rule in
SQL and pgTAP: shared chapters per Work, notes with three visibilities decided by one function, per-reader counts, the chapter
position, the moderation minimum and a server-side switch for *Everyone*. No UI (N2), no Realtime, no storage, **no change to
any `buddy_*` table or function**.

## Constraints

- **Live production database.** Only additive DDL: `create table`, `create index`, `create function`, `create or replace` of the
  two shipped functions named below (same signature, the old behaviour kept, one clause added). No `alter`/`drop` of anything
  that exists. The migration must run in one transaction on a database with members in it (it creates no rows except the one
  settings row).
- File: `supabase/migrations/<timestamp>_book_notes.sql`, timestamp **later than the newest on `origin/main`** when you start
  (on 6 Nov 2026 that was `20261115010000_google_books.sql`; check again). Never edit an applied migration.
- House style of the buddy migrations (`20261113010000_buddy_reads.sql`, `20261113030000_buddy_read_messages.sql`): a header
  comment that says what and why; every table `enable row level security` **with no policies** and
  `revoke all … from anon, authenticated`; every public function `security definer`, `set search_path` pinned
  (`pg_catalog, public, private` like the buddy ones, or `''` with qualified names for the private helpers), `auth.uid()`
  checked first (`not_signed_in`, `42501`), `revoke execute … from public, anon`, `grant execute … to authenticated`; errors
  as `raise exception '<code>' using errcode = …` with the house codes (`PT404` not found, `PT409` conflict, `PT403`
  forbidden, `PT429` rate limited, `22023` bad input).
- `pnpm schema:snapshot` (with `SUPABASE_WORKDIR=$STACK`) committed with the migration; the drift and "applied migrations are
  not edited" checks in CI must pass.

## Tables (all `public` unless named, RLS on, no policies)

| Table | Columns and constraints |
|---|---|
| `rooms` | `id uuid pk default gen_random_uuid()`, `kind text not null check (kind in ('notes','buddy'))` (only `notes` rows in N1; `buddy` arrives with N3), `work_key text not null`, `book_id uuid not null references books on delete restrict` (the edition it was started from), `chapters_set_by uuid references auth.users on delete set null`, `created_at timestamptz not null default clock_timestamp()`. Unique index `rooms_notes_work on (work_key) where kind = 'notes'` |
| `room_sections` | `id uuid pk`, `room_id uuid not null references rooms on delete cascade`, `position smallint not null check (position between 1 and 301)`, `kind text not null check (kind in ('part','end'))`, `label text` (null for notes in v1), `start_page int`, `end_page int`, `to_fraction numeric(5,4)` (null for notes). Unique `(room_id, position)`; one `end` row per room (partial unique index) and it has the highest position |
| `room_messages` | `id uuid pk`, `room_id uuid not null references rooms on delete cascade`, `section_id uuid references room_sections on delete cascade` (not null for notes; checked by trigger; a chapter is only ever removed while empty), `author_id uuid not null references auth.users on delete cascade`, `client_id uuid not null` (unique with `author_id`: a resend is the same note), `kind text not null default 'text' check (kind = 'text')` (voice is N4), `body text not null` (1–2000 characters, at least one visible character, as `buddy_messages`), `reply_to uuid references room_messages on delete set null`, `spoiler boolean not null default false`, `visibility text not null check (visibility in ('private','friends','public','members'))`, `created_at timestamptz not null default clock_timestamp()`, `deleted_at timestamptz`, `deleted_by uuid references auth.users on delete set null`, `moderated boolean not null default false` (removed by the owner) |
| `room_reactions` | `message_id uuid references room_messages on delete cascade`, `member_id uuid references auth.users on delete cascade`, `emoji text not null` (the six of `buddy_reactions`: ❤️ 😂 😮 😢 🔥 📚), `created_at`; pk `(message_id, member_id)` |
| `room_cursors` | `section_id uuid references room_sections on delete cascade`, `member_id uuid references auth.users on delete cascade`, `last_read_at timestamptz not null`; pk `(section_id, member_id)` |
| `note_positions` | `room_id uuid references rooms on delete cascade`, `member_id uuid references auth.users on delete cascade`, `hand_chapter smallint` (1..N), `hand_finished boolean not null default false`, `updated_at`; pk `(room_id, member_id)`; a row with neither set is deleted ("Automatic") |
| `private.notes_settings` | `id boolean pk default true check (id)`, `public_enabled boolean not null default true`, `updated_at timestamptz not null default now()`; the migration inserts the one row |
| `private.note_moderation_log` | `id uuid pk`, `message_id uuid` (no FK: the log outlives a deleted message), `room_id uuid`, `author_id uuid references auth.users on delete cascade` (the record goes with her account), `removed_by uuid`, `reason text not null`, `body text not null`, `visibility text not null`, `removed_at timestamptz not null default now()` |
| `private.note_calls` | `member_id uuid references auth.users on delete cascade`, `kind text`, `at timestamptz`: the ledger for limits that no table counts (chapter changes, reactions), as `private.buddy_calls` |

**Triggers** (on `room_messages`, `before insert or update`): in a `notes` room the visibility is not `members` and
`section_id` is not null; a reply is in the same room and section as its parent; **a reply's level is never wider than its
parent's** (order `private` < `friends` < `public`; `members` only with `members`). The RPCs check the same and say why; the
trigger is the backstop.

**Indexes**: `room_messages (room_id, section_id, created_at desc) where deleted_at is null`; `(author_id, created_at desc)`
(limits); `(reply_to) where reply_to is not null`; `(author_id) where visibility = 'public' and deleted_at is null` (the photo
rule); `room_sections (room_id, position)`; `rooms (book_id)`.

## Helpers (`private`, `stable`, pinned search path)

- `book_work_key(p_book uuid) returns text`: `'w:' || work_id` when `book_works.matched_by in ('openlibrary','isbn')`, else
  `'b:' || id`; **null for a Manual book** (`owner_id is not null`). Title matches are not trusted (plan 2.4).
- `mutual_friends(p_a uuid, p_b uuid) returns boolean`: both `follows` rows exist with `accepted_at is not null`.
- `notes_public_enabled() returns boolean`: the settings row, `false` if missing (`security definer`, as
  `private.cover_gc_enabled()`).
- `note_level(p_visibility text) returns int`: private 0, friends 1, public 2.
- `can_see_note(p_viewer uuid, p_note uuid) returns boolean`, **`security definer`, `set search_path = ''`**, in this order:
  viewer null → false; the note's room is not `notes` → false; viewer = author → true; `private.blocked_either(viewer, author)`
  → false; effective level = `friends` when the note is `public` and `notes_public_enabled()` is false, else its level;
  `private` → false; `friends` → `mutual_friends(viewer, author)`; `public` → true. Deleted notes are judged on the level they
  had (their tombstone is shown to whoever could see them).
- `visible_notes(p_viewer uuid, p_room uuid) returns setof public.room_messages`: the same predicate as a set (inline the
  joins: one query, no per-row function call, so a chapter count over a room stays one scan). **A test asserts that
  `visible_notes` and `can_see_note` agree for every fixture row.**
- `note_chapter(p_viewer uuid, p_room uuid) returns jsonb` `{chapter, finished, hand, auto}`: auto = her furthest point over
  **all** her Library entries whose Book has the room's `work_key`: a finished session at any time → finished; else the open
  session's `progress_page / coalesce(page_count_override, books.page_count)` or `progress_percent / 100`; with N parts,
  `chapter = greatest(1, floor(fraction × N))` once a session exists, 0 when none. The hand (`note_positions`) wins in both
  directions when set. Open chapters for her: 1..chapter; *The whole book* when finished.
- `note_quote(p_viewer uuid, p_parent uuid) returns jsonb`: `{id, author: member card, excerpt (≤ 140 chars), spoiler}` when
  `can_see_note(viewer, parent)`, else `{"hidden": true}`; a deleted parent `{"removed": true}`.

## Public functions (the contract N2 builds on; keep these names and arguments)

All return `jsonb` unless said; all check the caller first.

| Function | Does | Refuses |
|---|---|---|
| `notes_config()` | `{"publicEnabled": bool}` | `not_signed_in` |
| `book_notes(p_book uuid)` | the Notes page: `{workKey, canWrite, room: null \| {id, chapterCount, me: note_chapter, chapters: [{id, position, kind, count, unread, open, faces: [card ≤ 3]}]}}`; counts and faces from `visible_notes`; faces and unread only on open chapters; `canWrite` = she has an entry of the Work | `notes_unavailable` (Manual book, `22023`), `not_found` |
| `notes_summary(p_book uuid)` | the Book page: `{friends: {count, authors: [card ≤ 3], authorCount, firstChapter, lastChapter}, public: {count, authorCount}}`; friends = visible notes by her mutual friends (friends or public level); public = public notes by non-friends, only while the switch is on; her own never counted; zeros when no room | – |
| `set_book_chapters(p_book uuid, p_count int)` | creates the room (key `book_work_key`) and `p_count` parts + one `end` under `pg_advisory_xact_lock` on the work key; returns `book_notes` | `notes_unavailable`, `notes_need_book` (no entry of the Work, `PT403`), `chapters_already_set` (`PT409`, the client then shows the existing list), `invalid_count` (1..300), `rate_limited` |
| `add_book_chapters(p_room uuid, p_count int)` | appends parts before `end` (ids of existing rows kept; `end` moves up) | `notes_need_book`, `invalid_count` (total ≤ 300), `rate_limited` |
| `remove_book_chapters(p_room uuid, p_count int)` | removes the last `p_count` parts if **no message, deleted or not, from anyone** is in them, and at least 1 part stays | `chapter_has_notes` (`PT409`), `notes_need_book`, `rate_limited` |
| `set_note_chapter(p_room uuid, p_chapter int, p_finished boolean default false)` | the hand; `p_chapter null and not p_finished` = Automatic (row deleted); returns `note_chapter` | `invalid_chapter` |
| `note_messages(p_room uuid, p_section uuid, p_before timestamptz default null, p_limit int default 50)` | visible notes of one chapter, newest first, ≤ 100: `{id, clientId, author: card, mine, body (null on a tombstone), kind: 'note'\|'removed'\|'moderated', visibility, effectiveVisibility, spoiler, createdAt, quote: note_quote, reactions: [{emoji, count}], myReaction}`; reaction counts from members not blocked with the caller | `not_found` (room or section) |
| `post_note(p_room uuid, p_section uuid, p_client_id uuid, p_body text, p_visibility text, p_reply_to uuid default null, p_spoiler boolean default false)` | inserts; idempotent on `(author, client_id)`; returns the message as `note_messages` shows it | `notes_need_book`, `notes_public_off` (`PT409`), `reply_not_visible` (parent not visible to her), `note_wider_than_parent` (`22023`), `invalid_visibility`, body checks (`body_empty`, `body_too_long`), `rate_limited` (`PT429`) |
| `set_note_visibility(p_note uuid, p_visibility text)` | author only; **narrowing**: sets it and narrows every descendant reply whose level is now wider (recursive, all authors); **widening**: allowed up to the parent's level and to `public` only while the switch is on; replies never widened | `not_found` (not hers), `notes_public_off`, `note_wider_than_parent` |
| `react_to_note(p_note uuid, p_emoji text)` | one per member and note; same emoji again or null removes | `not_found` (not visible or deleted), `invalid_emoji`, `rate_limited` (60 a minute) |
| `delete_note(p_note uuid)` | author only; tombstone (`deleted_at`, body kept out of every answer); reactions removed | `not_found` |
| `report_note(p_note uuid, p_reason text, p_text text default null)` | one `public.feedback` row, `kind = 'report'`, body `Notes report: <reason>` plus the text, context `{room, chapter, note, author, visibility, excerpt ≤ 300}`; the feedback limiter applies (5 an hour, 20 a day); a second report of the same note by the same member makes no row; reasons as `report_buddy_message` (`harassment`, `spam`, `inappropriate`, `other`) | `not_found` (not visible), `report_self`, `invalid_reason`, `rate_limited` |
| `mark_notes_read(p_room uuid, p_section uuid, p_until timestamptz)` | moves her cursor forward only | `not_found` |
| `owner_set_notes_public(p_enabled boolean)` | flips the switch, `updated_at = now()` | `not_owner` (`42501`) unless `private.is_instance_owner()` |
| `owner_remove_note(p_note uuid, p_reason text)` | writes the log row (body, level, reason), then tombstones the note with `moderated = true`, reactions removed | `not_owner`, `not_found` |

Write `feedback` the way `report_buddy_message` does (it is the one writer of `kind = 'report'`; the members' insert policy
refuses that kind). The Feedback inbox reads `context` generically, so no change to `feedback` itself.

## Two shipped functions, changed additively

- `public.block()`: its eligibility guard (`private.reachable(...) or private.buddy_co_members(...)`, see
  `20261113050000_block_co_member.sql`) gains `or private.note_author_seen(caller, target)`: the target has a live note the
  caller can see. Everything else of `block()` unchanged (it deletes follows both ways, which also ends `friends` visibility).
- `private.can_see_photo(p_caller, p_owner)`: gains `or exists (a live public note by p_owner that p_caller can see)` (uses the
  partial index; respects blocks and the switch through `can_see_note`). It feeds `private.member_card` and the avatars bucket's
  read policy (`public.can_see_member_folder`), so a public note's readers see its author's photo (decision 22).

pgTAP proves the old behaviour of both is unchanged (the existing `block_co_member_test.sql`, `avatars_test.sql` and the social
tests stay green) and the new clause works.

## Limits

Notes 30 a minute and 300 a day a member (counted on `room_messages` by `author_id`); public notes 30 a day; chapter changes
(`set/add/remove_book_chapters`) 20 a day (`private.note_calls`); reactions 60 a minute (ledger). `rate_limited`, `PT429`.

## Housekeeping

- A pg_cron job `purge-note-moderation-log`, monthly, deletes log rows older than 12 months (the schema snapshot lists cron jobs).
- `delete_my_account`: nothing to add if every FK above cascades; pgTAP proves her notes, reactions, positions, cursors and log
  rows go, and that another member's reply to her note keeps its row with `reply_to` null.
- `docs/OPERATIONS.md`: a short *Notes* section: the switch (`select public.owner_set_notes_public(false);` as the owner, or the
  `update` on `private.notes_settings`), the log and its purge, the limits.

## pgTAP (`supabase/tests/book_notes_test.sql`, more files if it grows)

Fixture members: **A** (author), **F** (A and F follow each other, accepted), **O1** (A follows O1 only), **O2** (O2 follows A
only), **P** (requested, not accepted), **S** (a member, no relation), **B** (blocked: A blocked B, and a second case B blocked
A), **owner** (in `private.instance_owner`), and `anon`.

1. **The matrix**: for each note level (private, friends, public) × switch (on, off) × viewer (A, F, O1, O2, P, S, B, anon):
   `can_see_note` as in plan 2.3; `visible_notes` agrees with it row by row; `note_messages`, `book_notes` counts and faces and
   `notes_summary` agree for each viewer. Expected: private → A only; friends → A, F; public → A, F, O1, O2, P, S (switch on),
   A, F (switch off); B and anon never.
2. **Replies**: default level is the client's; a reply wider than its parent refused (`note_wider_than_parent`), also by the
   trigger with a direct insert as `postgres`; a reply to an invisible parent refused; the quote hidden for a viewer who sees
   the reply but not the parent (`{"hidden": true}`), the split table of plan 2.3.2 reproduced.
3. **Changing level**: narrowing cascades to wider descendants of other authors; widening above the parent refused; widening to
   public refused with the switch off; a tombstone keeps its level.
4. **Counts never leak**: a chapter holding only notes the viewer cannot see counts 0 for her; unread counts only open chapters;
   reactions from a blocked member are not counted.
5. **Chapters**: set once; a second `set_book_chapters` on the same Work (another edition with the same `work_key`) gets
   `chapters_already_set`; two editions tied by Open Library share the room; a title-matched edition does not; Manual book
   refused; add keeps ids; remove refused when any note (deleted or not) sits in a removed part; limits.
6. **Chapter rule**: worked examples: 43 parts, page 119 of 384 (31 %) → chapter 13; percent 50 → 21; finished last year →
   finished; no session → 0; two editions, the furthest wins; the hand below and above the auto value wins; Automatic clears.
7. **Moderation**: report rows and dedupe, `report_self`, the feedback limiter; owner functions refused for others; removal
   logs then tombstones; the purge job deletes only rows older than 12 months.
8. **Shipped functions**: `block()` now accepts a target whose public note the caller sees, and still refuses a stranger with no
   note; `can_see_photo` true through a public note, false through a friends note of a non-friend, false across a block and with
   the switch off.
9. **Grants**: `anon` can execute nothing new; `authenticated` can select no new table; every new public function is
   `security definer` with a pinned search path (assert from `pg_proc`).
10. **Account deletion** as above.

## Done when

The migration applies on a fresh stack and on one with seed data; the pgTAP files pass; `pnpm test` passes; the snapshot is
fresh; the PR is green on the checks named in [README.md](README.md); the PR body lists decisions 2–9, 15–27 it implements and
the function contract above (N2 relies on it). Report the PR URL and anything the security review should look at first.
