-- Notes on a Book, N1: the database (docs/plans/book-notes.md parts 1.3, 2, 4, 5.1 and 8;
-- docs/plans/book-notes/briefs/N1-database.md).
--
-- Notes is the base a buddy read will later sit on: one notes room per Book (its Work), whose chapters
-- anyone with the Book sets once and everybody shares, a thread per chapter, and notes in it. Every note
-- and every reply carries its own visibility, chosen by its author: `private` (Only me), `friends` (the
-- members she follows who follow her back, both accepted; the default in the app) or `public`
-- (Everyone: every signed-in member, never anyone signed out). One function decides who sees a note,
-- private.can_see_note, and every read path goes through it or through its set-returning twin
-- private.visible_notes, which holds the same predicate: the thread, the chapter counts, unread, faces,
-- the Book page lines, quotes, reactions, reports, the block guard and the photo rule.
--
-- What this migration adds (nothing it does alters or drops an existing table, column, index or policy):
--   tables   public.rooms, public.room_sections, public.room_messages, public.room_reactions,
--            public.room_cursors, public.note_positions; private.notes_settings (one row, inserted here:
--            public_enabled = false: Everyone is off at release, safe by default), private.note_moderation_log,
--            private.note_calls.
--            RLS on, no policies, nothing granted to anon or authenticated (the default privileges of this
--            project grant every new public table to both, so the revoke is explicit): every read and
--            write is one of the functions below.
--   triggers private.room_messages_check (before insert or update: the kind of room decides the
--            visibility, the chapter is the room's, a reply stays in its parent's thread and is never wider
--            than its parent), private.room_messages_replies_check (a deferred constraint trigger: a note
--            is never narrower than one of its replies at commit), private.room_sections_order (a
--            deferred constraint trigger: positions 1..n, one `end`, last). All three are security definer
--            with an empty search_path: a deferred trigger fires at COMMIT, after the RPC has returned, as
--            the caller's role (authenticated), which may read none of these tables.
--   helpers  private.book_work_key, private.work_books, private.notes_room_for, private.has_work,
--            private.mutual_friends, private.notes_public_enabled, private.note_level,
--            private.can_see_note, private.visible_notes, private.note_chapter, private.note_quote,
--            private.note_json, private.notes_page, private.notes_lock, private.note_rate,
--            private.note_author_seen, private.purge_note_moderation_log.
--   RPCs     notes_config, book_notes, notes_summary, set_book_chapters, add_book_chapters,
--            set_note_chapter, note_messages, post_note, set_note_visibility, react_to_note, delete_note,
--            report_note, mark_notes_read, owner_set_notes_public, owner_remove_note,
--            owner_set_chapter_count. There is no member function that removes chapters: whether a
--            chapter holds a note depends on notes a member may not see, so a refusal would tell her one
--            exists. A wrong count is mended by adding chapters, or by the owner (owner_set_chapter_count,
--            logged, never below the highest chapter holding a note).
--   changes  two shipped functions, additively (create or replace, same signature, owner, security,
--            search_path and grants; one clause each, the rest of the body copied unchanged):
--            public.block() also accepts a member whose live note the caller can see
--            (private.note_author_seen), so she can block the author of a public note who is not her
--            friend; private.can_see_photo also answers true for the author of a live public note the
--            caller can see while Everyone is on (decision 22), which private.member_card and the avatars
--            bucket's read policy (public.can_see_member_folder / _file) use as they are.
--   cron     purge-note-moderation-log, monthly: the owner's records older than 12 months go.
--
-- Not here: any change to a buddy_* table or function (N3 moves buddy reads onto these tables), Realtime,
-- storage, voice (N4), the screens (N2), chapter names.
--
-- Who sees a note, private.can_see_note(viewer, note), in this order:
--   1. no viewer (signed out) -> no;
--   2. the note is not in a `notes` room -> no (a buddy room's messages keep their own gate);
--   3. the viewer is its author -> yes (all levels, her tombstones too);
--   4. either blocked the other (private.blocked_either) -> no, at every level, public included;
--   5. the effective level: `public` counts as `friends` while private.notes_settings.public_enabled is off;
--   6. `private` -> no; `friends` -> private.mutual_friends(viewer, author); `public` -> yes.
-- A tombstone is judged on the level it had. The veil (chapters after hers) is the app's, as in buddy
-- reads: the database answers a chapter's notes to whoever may see them, and says which chapters are open.
--
-- Counts never count what the reader cannot see: every number (a chapter's count and unread, its faces,
-- the Book page's lines, reactions) is worked out per reader from private.visible_notes, live, no stored
-- counter. Reactions are counted from members not blocked with the reader.
--
-- Her chapter (private.note_chapter): her furthest point over all her Library entries of the Work: a
-- finished session at any time is the whole Book; else the open session's page over her edition's page
-- count (her own count first), or its percent. With N chapters she is on floor(fraction x N), at least 1
-- once a session is open, 0 with none. Her hand (note_positions) wins both ways until she picks Automatic.
-- Open for her: chapters 1 to hers; all of them and *The whole book* once finished.
--
-- The Work: private.book_work_key(book) = 'w:' || work id when book_works ties the Book to its Work by
-- Open Library or ISBN, else 'b:' || the Book's id (a room for that edition); null for a Manual book (no
-- Notes on Manual books, decision 15). Title matches are not trusted (plan 2.4). A room once made keeps
-- its key: an edition whose key changed later (matched to its Work after the room was made) still finds
-- its edition's room (private.notes_room_for looks for the Work's room first, then the edition's).
--
-- Refusals, as stable messages (the client maps by message): not_signed_in 42501; not_owner 42501;
-- not_found PT404 (no such room, chapter or Book, a note she may not see or not hers to change: one
-- answer, so a hidden note's existence is never revealed); notes_need_book PT403 (no entry of the Work);
-- chapters_already_set, chapter_has_notes, notes_public_off, client_id_reused PT409; rate_limited PT429;
-- 22023: notes_unavailable (a Manual book of hers), invalid_count, invalid_chapter, invalid_visibility,
-- body_empty, body_too_long, client_id_required, reply_not_visible, note_wider_than_parent,
-- invalid_emoji, invalid_reason, report_text_too_long, report_self, invalid_value.
--
-- Limits: notes 30 a minute and 300 a day a member, counted on room_messages by author_id (a deleted
-- note still counts); every move to Everyone (a post at Everyone, a widening to it) is one use of 30 in
-- 24 hours, counted in private.note_calls (kind 'public'), so narrowing and widening again, or deleting
-- and posting again, never frees one; chapter changes (set, add) 20 a day and reactions 60 a minute, in
-- private.note_calls too (the private.buddy_calls pattern); reports by the feedback limiter (5 an hour,
-- 20 a day), one row per reporter and note.
--
-- Lock order (advisory, transaction scoped; always in this order, never back):
--   1. the member's lock   hashtextextended('notes:' || member, 0)        her client ids, her limits, her
--                                                                         reports;
--   2. the room's lock     hashtextextended('notes_room:' || room, 0)     posts (their order in a thread),
--                                                                         visibility changes, adding
--                                                                         chapters, the owner's count;
--      or the Work's lock  hashtextextended('notes_work:' || work key, 0) making a room (set_book_chapters);
--   3. row locks;
--   4. leaf locks, holding nothing after them: private.note_rate's
--      hashtextextended('notes_rate:' || member || ':' || kind, 0) and the feedback trigger's.
-- A post and the owner's change of the count queue on 2, so a note never lands in a chapter that is being
-- removed (the change sees it and refuses, or the post finds no chapter). A note's created_at is
-- greatest(clock_timestamp(), the thread's newest + 1 us), worked out under 2: a thread pages by time.
--
-- Live database: this migration runs in one transaction on a database with members in it. It creates
-- tables, indexes, functions, triggers on its own new tables and one cron job, inserts the one settings
-- row, and replaces two functions (no table rewrite, no lock on a member table beyond the moment the
-- foreign keys to books and auth.users are made). A lock it cannot get in 5 s fails it (and rolls it
-- back) instead of queueing readers behind it.

set local lock_timeout = '5s';

-- -------------------------------------------------------------------------- tables

create table public.rooms (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('notes', 'buddy')),
  work_key        text not null
                  check (work_key ~ '^[wb]:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  book_id         uuid not null references public.books (id) on delete restrict,
  chapters_set_by uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default clock_timestamp()
);

create unique index rooms_notes_work on public.rooms (work_key) where kind = 'notes';
create index rooms_book on public.rooms (book_id);
create index rooms_chapters_set_by on public.rooms (chapters_set_by) where chapters_set_by is not null;

comment on table public.rooms is
  'Rooms (20261116010000): the shared base of Notes and (from N3) buddy reads. kind notes: one room per '
  'Work (work_key = private.book_work_key of an edition), its Sections are the Book''s chapters, each message '
  'carries its own visibility. book_id is the edition it was started from. chapters_set_by is kept only to '
  'limit abuse and goes with her account. Read and written only through the Notes functions.';

create table public.room_sections (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  position    smallint not null check (position between 1 and 301),
  kind        text not null check (kind in ('part', 'end')),
  label       text check (label is null or char_length(label) between 1 and 120),
  start_page  integer,
  end_page    integer,
  to_fraction numeric(5, 4) check (to_fraction is null or (to_fraction > 0 and to_fraction <= 1)),
  unique (room_id, position),
  check ((start_page is null) = (end_page is null) and (start_page is null or end_page >= start_page))
);

create unique index room_sections_one_end on public.room_sections (room_id) where kind = 'end';

comment on table public.room_sections is
  'Rooms: the Sections of a room, in order: parts 1..n, then the one end Section (The whole book), last. '
  'In a notes room they are the Book''s chapters, numbers only (label and to_fraction null): her chapter is '
  'worked out from the count (private.note_chapter).';

create table public.room_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  section_id  uuid references public.room_sections (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  client_id   uuid not null,
  kind        text not null default 'text' check (kind = 'text'),
  body        text not null,
  reply_to    uuid references public.room_messages (id) on delete set null,
  spoiler     boolean not null default false,
  visibility  text not null check (visibility in ('private', 'friends', 'public', 'members')),
  created_at  timestamptz not null default clock_timestamp(),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users (id) on delete set null,
  moderated   boolean not null default false,
  unique (author_id, client_id),
  -- A tombstone keeps nothing it said; a live note has 1..2000 characters with something visible.
  constraint room_messages_shape check (case
    when deleted_at is not null then body = ''
    else char_length(body) between 1 and 2000 and body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'
  end),
  constraint room_messages_deleted_by check (deleted_by is null or deleted_at is not null),
  constraint room_messages_moderated check (not moderated or deleted_at is not null)
);

-- The thread and the counts (tombstones are part of every thread, so not partial), a chapter's own rows
-- (the removal check, the newest time, the foreign key), her limits, replies, the photo rule.
create index room_messages_room on public.room_messages (room_id, section_id, created_at desc);
create index room_messages_section on public.room_messages (section_id, created_at desc);
create index room_messages_author on public.room_messages (author_id, created_at desc);
create index room_messages_reply_to on public.room_messages (reply_to) where reply_to is not null;
create index room_messages_public_author on public.room_messages (author_id)
  where visibility = 'public' and deleted_at is null;
create index room_messages_deleted_by on public.room_messages (deleted_by) where deleted_by is not null;

comment on table public.room_messages is
  'Rooms: messages. In a notes room each note has its own visibility (private | friends | public; '
  'members is a buddy room''s), decided for every read by private.can_see_note. A reply is never wider '
  'than the note it answers. A tombstone (deleted_at) keeps its level and nothing it said; moderated = '
  'removed by the owner (the text is in private.note_moderation_log).';

create table public.room_reactions (
  message_id uuid not null references public.room_messages (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '😂', '😮', '😢', '🔥', '📚')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, member_id)
);

create index room_reactions_member on public.room_reactions (member_id);

comment on table public.room_reactions is
  'Rooms: one reaction per member and message, one of six emoji. Shown as counts, never names.';

create table public.room_cursors (
  section_id   uuid not null references public.room_sections (id) on delete cascade,
  member_id    uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (section_id, member_id)
);

create index room_cursors_member on public.room_cursors (member_id);

comment on table public.room_cursors is
  'Rooms: how far a member has read a Section''s thread; only moves forward (mark_notes_read).';

create table public.note_positions (
  room_id       uuid not null references public.rooms (id) on delete cascade,
  member_id     uuid not null references auth.users (id) on delete cascade,
  hand_chapter  smallint check (hand_chapter >= 1),
  hand_finished boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (room_id, member_id),
  check (hand_chapter is not null or hand_finished)
);

create index note_positions_member on public.note_positions (member_id);

comment on table public.note_positions is
  'Notes: the chapter a reader set by hand ("You''re on chapter 5"), or that she has finished. No row = '
  'Automatic (from her progress). Read by nobody but her: nobody sees anyone''s chapter in Notes.';

create table private.notes_settings (
  id             boolean primary key default true check (id),
  public_enabled boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- Off at release (safe by default); the owner turns it on when the screens ship (docs/OPERATIONS.md, "Notes").
insert into private.notes_settings (id, public_enabled) values (true, false) on conflict (id) do nothing;

comment on table private.notes_settings is
  'Notes: one row. public_enabled = the switch for Everyone (off at release; the owner turns it on with '
  'public.owner_set_notes_public(true); off again before open sign-up unless moderation has grown). Off: '
  'posting or widening to public is refused and every public note counts as a friends note for every reader.';

create table private.note_moderation_log (
  id         uuid primary key default gen_random_uuid(),
  action     text not null default 'remove_note' check (action in ('remove_note', 'chapter_count')),
  message_id uuid,
  room_id    uuid not null,
  author_id  uuid references auth.users (id) on delete cascade,
  removed_by uuid references auth.users (id) on delete set null,
  reason     text not null,
  body       text,
  visibility text,
  removed_at timestamptz not null default now(),
  -- A removed note keeps its id, text and level; a change of the chapter count says it in `reason`.
  check (action <> 'remove_note' or (message_id is not null and body is not null and visibility is not null))
);

create index note_moderation_log_author on private.note_moderation_log (author_id);
create index note_moderation_log_removed_by on private.note_moderation_log (removed_by) where removed_by is not null;
create index note_moderation_log_removed_at on private.note_moderation_log (removed_at);

comment on table private.note_moderation_log is
  'Notes: what the owner did. remove_note (owner_remove_note): the text, its level and the reason, kept 12 '
  'months to answer a complaint (pg_cron purge-note-moderation-log), and with the author''s account no '
  'longer. chapter_count (owner_set_chapter_count): the old and the new count in reason. No foreign key on '
  'message_id or room_id: the record outlives what it is about.';

create table private.note_calls (
  member_id uuid not null references auth.users (id) on delete cascade,
  kind      text not null,
  at        timestamptz not null default now()
);

create index note_calls_member_at on private.note_calls (member_id, kind, at);

comment on table private.note_calls is
  'Notes: the ledger of the limits no table counts (chapter changes, reactions); rows older than the window '
  'are deleted by the next call of that member and kind.';

alter table public.rooms enable row level security;
alter table public.room_sections enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reactions enable row level security;
alter table public.room_cursors enable row level security;
alter table public.note_positions enable row level security;
alter table private.notes_settings enable row level security;
alter table private.note_moderation_log enable row level security;
alter table private.note_calls enable row level security;

-- Supabase grants every new public table to the API roles; these want none. No policies either.
revoke all on public.rooms from anon, authenticated;
revoke all on public.room_sections from anon, authenticated;
revoke all on public.room_messages from anon, authenticated;
revoke all on public.room_reactions from anon, authenticated;
revoke all on public.room_cursors from anon, authenticated;
revoke all on public.note_positions from anon, authenticated;

-- -------------------------------------------------------------------------- helpers

-- A visibility's order: Only me < Friends < Everyone. Null for `members` (a buddy room's) and anything else.
create or replace function private.note_level(p_visibility text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_visibility when 'private' then 0 when 'friends' then 1 when 'public' then 2 end
$$;

-- The key of a Book's notes room: its Work when Open Library or an ISBN tied it to one, else the Book
-- itself; null for a Manual book (or no such Book). Title matches are not trusted.
create or replace function private.book_work_key(p_book uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select case
           when b.owner_id is not null then null
           when bw.matched_by in ('openlibrary', 'isbn') then 'w:' || bw.work_id::text
           else 'b:' || b.id::text
         end
    from public.books b
    left join public.book_works bw on bw.book_id = b.id
   where b.id = p_book
$$;

-- The Catalogue Books whose key is this one (the editions of the Work, or the one Book).
create or replace function private.work_books(p_work_key text)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select b.id
    from public.book_works bw
    join public.books b on b.id = bw.book_id
   where left(p_work_key, 2) = 'w:' and bw.work_id = substr(p_work_key, 3)::uuid
     and bw.matched_by in ('openlibrary', 'isbn') and b.owner_id is null
  union
  select b.id
    from public.books b
   where left(p_work_key, 2) = 'b:' and b.id = substr(p_work_key, 3)::uuid and b.owner_id is null
$$;

-- The notes room of a Book: its Work's, else one made on this edition before its key changed.
create or replace function private.notes_room_for(p_book uuid)
returns public.rooms
language sql
stable
set search_path = ''
as $$
  select r.*
    from public.rooms r
   where r.kind = 'notes'
     and r.work_key in (private.book_work_key(p_book), 'b:' || p_book::text)
   order by (r.work_key = private.book_work_key(p_book)) desc
   limit 1
$$;

-- She has an entry of the Work in her Library (any edition, any status): what writing and setting
-- chapters need (decision 9).
create or replace function private.has_work(p_member uuid, p_work_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_member is not null and p_work_key is not null and exists (
    select 1 from public.library_entries e
     where e.member_id = p_member and e.book_id in (select private.work_books(p_work_key))
  )
$$;

-- Friends: each follows the other, both accepted.
create or replace function private.mutual_friends(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (select 1 from public.follows f
                  where f.follower_id = p_a and f.followee_id = p_b and f.accepted_at is not null)
     and exists (select 1 from public.follows f
                  where f.follower_id = p_b and f.followee_id = p_a and f.accepted_at is not null)
$$;

-- The switch for Everyone; off when the row is missing.
create or replace function private.notes_public_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.public_enabled from private.notes_settings s where s.id), false)
$$;

-- THE rule: may this viewer see this note (header, "Who sees a note").
create or replace function private.can_see_note(p_viewer uuid, p_note uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
             when p_viewer is null then false
             when r.kind <> 'notes' then false
             when m.author_id = p_viewer then true
             when private.blocked_either(p_viewer, m.author_id) then false
             when m.visibility = 'public' and private.notes_public_enabled() then true
             when m.visibility in ('friends', 'public') then private.mutual_friends(p_viewer, m.author_id)
             else false
           end
      from public.room_messages m
      join public.rooms r on r.id = m.room_id
     where m.id = p_note
  ), false)
$$;

-- The same rule as a set: every note of a room this viewer may see, tombstones included. One query, the
-- joins inline (no call per row), so a count over a room is one scan. pgTAP proves it agrees with
-- private.can_see_note row by row.
create or replace function private.visible_notes(p_viewer uuid, p_room uuid)
returns setof public.room_messages
language sql
stable
set search_path = ''
as $$
  with s as (
    select coalesce((select x.public_enabled from private.notes_settings x where x.id), false) as public_on
  )
  select m.*
    from public.room_messages m
    join public.rooms r on r.id = m.room_id and r.kind = 'notes'
    cross join s
   where m.room_id = p_room
     and p_viewer is not null
     and (m.author_id = p_viewer
          or (not exists (select 1 from public.blocks b
                           where (b.blocker_id = p_viewer and b.blocked_id = m.author_id)
                              or (b.blocker_id = m.author_id and b.blocked_id = p_viewer))
              and ((m.visibility = 'public' and s.public_on)
                   or (m.visibility in ('friends', 'public')
                       and exists (select 1 from public.follows f
                                    where f.follower_id = p_viewer and f.followee_id = m.author_id
                                      and f.accepted_at is not null)
                       and exists (select 1 from public.follows f
                                    where f.follower_id = m.author_id and f.followee_id = p_viewer
                                      and f.accepted_at is not null)))))
$$;

-- Her chapter in a notes room: { chapter, finished, hand, auto: { chapter, finished } }. `chapter` and
-- `finished` are what counts (the hand when she set one, else auto); `hand` says she set it.
create or replace function private.note_chapter(p_viewer uuid, p_room uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key      text;
  v_parts    integer;
  v_finished boolean;
  v_fraction numeric;
  v_auto     integer;
  v_hand     public.note_positions;
begin
  select r.work_key into v_key from public.rooms r where r.id = p_room;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  -- Over all her entries of the Work: a finished read at any time, and the furthest open session.
  select coalesce(bool_or(exists (select 1 from public.reading_sessions f
                                    where f.entry_id = e.id and f.outcome = 'finished')), false),
         max(case when o.id is not null then
               least(1::numeric, coalesce(o.progress_page::numeric / nullif(coalesce(e.page_count_override, b.page_count), 0),
                                          o.progress_percent::numeric / 100,
                                          0))
             end)
    into v_finished, v_fraction
    from public.library_entries e
    join public.books b on b.id = e.book_id
    left join public.reading_sessions o on o.entry_id = e.id and o.outcome is null
   where p_viewer is not null and e.member_id = p_viewer
     and e.book_id in (select private.work_books(v_key));

  v_auto := case when v_finished then v_parts
                 when v_fraction is not null then least(v_parts, greatest(1, floor(v_fraction * v_parts)::integer))
                 else 0 end;

  select * into v_hand from public.note_positions p where p.room_id = p_room and p.member_id = p_viewer;

  return jsonb_build_object(
    'chapter', case when v_hand.member_id is null then v_auto
                    when v_hand.hand_finished then v_parts
                    else least(v_hand.hand_chapter::integer, v_parts) end,
    'finished', case when v_hand.member_id is null then v_finished else v_hand.hand_finished end,
    'hand', v_hand.member_id is not null,
    'auto', jsonb_build_object('chapter', v_auto, 'finished', v_finished));
end;
$$;

-- The quote of the note a reply answers, as this viewer may see it: { id, author, excerpt, spoiler },
-- { "hidden": true } when she may not see it (never its words or author), { "removed": true } for a
-- tombstone she may see. Null when the reply answers nothing (or the parent is gone with its account).
create or replace function private.note_quote(p_viewer uuid, p_parent uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
           when m.id is null then null
           when not private.can_see_note(p_viewer, m.id) then jsonb_build_object('hidden', true)
           when m.deleted_at is not null then jsonb_build_object('removed', true)
           else jsonb_build_object('id', m.id,
                                   'author', private.member_card(p_viewer, m.author_id),
                                   'excerpt', left(m.body, 140),
                                   'spoiler', m.spoiler)
         end
    from (select 1) one
    left join public.room_messages m on m.id = p_parent
$$;

-- A note as note_messages shows it to this viewer (who may see it: the caller checked).
create or replace function private.note_json(p_viewer uuid, p_note public.room_messages)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_note.id,
    'sectionId', p_note.section_id,
    'clientId', case when p_note.author_id = p_viewer then p_note.client_id end,
    'author', private.member_card(p_viewer, p_note.author_id),
    'mine', p_note.author_id = p_viewer,
    'body', case when p_note.deleted_at is null then p_note.body end,
    'kind', case when p_note.deleted_at is null then 'note'
                 when p_note.moderated then 'moderated'
                 else 'removed' end,
    'visibility', p_note.visibility,
    'effectiveVisibility', case when p_note.visibility = 'public' and not private.notes_public_enabled()
                                then 'friends' else p_note.visibility end,
    'spoiler', p_note.spoiler,
    'createdAt', p_note.created_at,
    'quote', case when p_note.reply_to is not null then private.note_quote(p_viewer, p_note.reply_to) end,
    'reactions', case when p_note.deleted_at is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n)
                         order by array_position(array['❤️', '😂', '😮', '😢', '🔥', '📚'], x.emoji))
          from (select r.emoji, count(*)::integer as n
                  from public.room_reactions r
                 where r.message_id = p_note.id
                   and (r.member_id = p_viewer or not private.blocked_either(p_viewer, r.member_id))
                 group by r.emoji) x), '[]'::jsonb) end,
    'myReaction', case when p_note.deleted_at is null then
        (select r.emoji from public.room_reactions r where r.message_id = p_note.id and r.member_id = p_viewer) end)
$$;

-- The Notes page of a Work for this viewer (book_notes' answer, and set/add_book_chapters').
create or replace function private.notes_page(p_viewer uuid, p_work_key text, p_room uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_me       jsonb;
  v_chapter  integer;
  v_finished boolean;
  v_parts    integer;
  v_chapters jsonb;
begin
  if p_room is null then
    return jsonb_build_object('workKey', p_work_key, 'canWrite', private.has_work(p_viewer, p_work_key), 'room', null);
  end if;

  v_me := private.note_chapter(p_viewer, p_room);
  v_chapter := (v_me ->> 'chapter')::integer;
  v_finished := (v_me ->> 'finished')::boolean;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  with v as materialized (
    select n.section_id, n.author_id, n.created_at
      from private.visible_notes(p_viewer, p_room) n
     where n.deleted_at is null
  ),
  counts as (
    select v.section_id,
           count(*)::integer as n,
           count(*) filter (where v.author_id <> p_viewer
                              and (c.last_read_at is null or v.created_at > c.last_read_at))::integer as unread
      from v
      left join public.room_cursors c on c.section_id = v.section_id and c.member_id = p_viewer
     group by v.section_id
  ),
  authors as (
    select a.section_id, array_agg(a.author_id order by a.last desc, a.author_id) as ids
      from (select v.section_id, v.author_id, max(v.created_at) as last,
                   row_number() over (partition by v.section_id order by max(v.created_at) desc, v.author_id) as k
              from v group by v.section_id, v.author_id) a
     where a.k <= 3
     group by a.section_id
  ),
  secs as (
    select s.id, s.position, s.kind,
           case when s.kind = 'part' then v_finished or s.position <= v_chapter else v_finished end as open
      from public.room_sections s
     where s.room_id = p_room
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', secs.id,
           'position', secs.position,
           'kind', secs.kind,
           'count', coalesce(counts.n, 0),
           'unread', case when secs.open then coalesce(counts.unread, 0) else 0 end,
           'open', secs.open,
           'faces', case when secs.open and authors.ids is not null
                         then (select jsonb_agg(private.member_card(p_viewer, x.id) order by x.o)
                                 from unnest(authors.ids) with ordinality x(id, o))
                         else '[]'::jsonb end)
         order by secs.position), '[]'::jsonb)
    into v_chapters
    from secs
    left join counts on counts.section_id = secs.id
    left join authors on authors.section_id = secs.id;

  return jsonb_build_object(
    'workKey', p_work_key,
    'canWrite', private.has_work(p_viewer, p_work_key),
    'room', jsonb_build_object('id', p_room, 'chapterCount', v_parts, 'me', v_me, 'chapters', v_chapters));
end;
$$;

-- The advisory locks of the header (2).
create or replace function private.notes_lock(p_kind text, p_key text)
returns void
language sql
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_key, 0))
$$;

-- A limit of one kind of call in a window: forget older calls, refuse at the limit, count this one.
-- A leaf lock (header, 4).
create or replace function private.note_rate(p_member uuid, p_kind text, p_limit integer, p_window interval)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('notes_rate:' || p_member::text || ':' || p_kind, 0));
  delete from private.note_calls c
   where c.member_id = p_member and c.kind = p_kind and c.at < now() - p_window;
  if (select count(*) from private.note_calls c
       where c.member_id = p_member and c.kind = p_kind and c.at > now() - p_window) >= p_limit then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into private.note_calls (member_id, kind) values (p_member, p_kind);
end;
$$;

-- The target has a live note the caller can see: what lets her block its author (public.block). Security
-- definer, so it reads room_messages whoever calls it.
create or replace function private.note_author_seen(p_caller uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_caller is not null and p_target is not null and p_caller <> p_target
     and not private.blocked_either(p_caller, p_target)
     and exists (select 1 from public.room_messages m
                  where m.author_id = p_target and m.deleted_at is null
                    and private.can_see_note(p_caller, m.id))
$$;

-- While Everyone is on, the owner has a live public note the caller can see (and neither blocked the
-- other): what shows her photo to its readers (private.can_see_photo, decision 22). Security definer, so
-- can_see_photo, which runs as whoever calls it, never reads room_messages itself.
create or replace function private.note_photo_seen(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_caller is not null and p_owner is not null
     and private.notes_public_enabled()
     and not private.blocked_either(p_caller, p_owner)
     and exists (select 1 from public.room_messages m
                  where m.author_id = p_owner and m.visibility = 'public' and m.deleted_at is null
                    and private.can_see_note(p_caller, m.id))
$$;

-- The owner's removal records older than 12 months go (pg_cron, monthly).
create or replace function private.purge_note_moderation_log()
returns integer
language sql
set search_path = ''
as $$
  with gone as (
    delete from private.note_moderation_log l where l.removed_at < now() - interval '12 months' returning 1
  )
  select count(*)::integer from gone
$$;

comment on function private.purge_note_moderation_log() is
  'Deletes the Notes moderation records older than 12 months and answers how many. Run monthly by pg_cron; not callable by members.';

-- -------------------------------------------------------------------------- triggers

-- A message as its room allows it: a notes room's notes have a chapter of that room and one of the three
-- levels; a buddy room's are `members`. A reply stays in its parent's room and thread and is never wider
-- than its parent. The functions check the same and say why; this is the backstop.
create or replace function private.room_messages_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind   text;
  v_parent public.room_messages;
begin
  select r.kind into v_kind from public.rooms r where r.id = new.room_id;

  if v_kind = 'notes' then
    if new.visibility = 'members' then
      raise exception 'room_message_invalid: a note is private, friends or public' using errcode = '23514';
    end if;
    if new.section_id is null then
      raise exception 'room_message_invalid: a note is in a chapter' using errcode = '23514';
    end if;
  elsif new.visibility <> 'members' then
    raise exception 'room_message_invalid: a buddy message is for its members' using errcode = '23514';
  end if;

  if new.section_id is not null
     and not exists (select 1 from public.room_sections s where s.id = new.section_id and s.room_id = new.room_id) then
    raise exception 'room_message_invalid: the Section is of another room' using errcode = '23514';
  end if;

  if new.reply_to is not null
     and (tg_op = 'INSERT' or new.reply_to is distinct from old.reply_to
          or new.visibility is distinct from old.visibility
          or new.room_id is distinct from old.room_id or new.section_id is distinct from old.section_id) then
    select * into v_parent from public.room_messages p where p.id = new.reply_to;
    if v_parent.room_id is distinct from new.room_id or v_parent.section_id is distinct from new.section_id then
      raise exception 'room_message_invalid: a reply stays in its thread' using errcode = '23514';
    end if;
    if (new.visibility = 'members') <> (v_parent.visibility = 'members')
       or private.note_level(new.visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger room_messages_check
  before insert or update on public.room_messages
  for each row execute function private.room_messages_check();

-- At commit: a note narrowed is not narrower than any reply to it (set_note_visibility narrows the replies
-- in the same transaction).
create or replace function private.room_messages_replies_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.room_messages c
               join public.room_messages p on p.id = c.reply_to
              where p.id = new.id
                and private.note_level(c.visibility) > private.note_level(p.visibility)) then
    raise exception 'note_wider_than_parent' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger room_messages_replies_check
  after update of visibility on public.room_messages
  deferrable initially deferred
  for each row execute function private.room_messages_replies_check();

-- At commit: a room's Sections are numbered 1..n, with one `end`, last.
create or replace function private.room_sections_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid := coalesce(new.room_id, old.room_id);
begin
  if exists (select 1 from public.rooms r where r.id = v_room)
     and exists (select 1 from public.room_sections s where s.room_id = v_room)
     and not (select count(*) = max(s.position)
                     and count(*) filter (where s.kind = 'end') = 1
                     and max(s.position) filter (where s.kind = 'end') = max(s.position)
                from public.room_sections s where s.room_id = v_room) then
    raise exception 'room_sections_invalid: positions 1..n, one end, last' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger room_sections_order
  after insert or update or delete on public.room_sections
  deferrable initially deferred
  for each row execute function private.room_sections_order();

-- -------------------------------------------------------------------------- RPCs

-- { "publicEnabled": bool }: whether Everyone can be chosen now.
create or replace function public.notes_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return jsonb_build_object('publicEnabled', private.notes_public_enabled());
end;
$$;

-- The Notes page of a Book: { workKey, canWrite, room: null | { id, chapterCount, me, chapters } }.
create or replace function public.book_notes(p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_key    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if not found or (v_owner is not null and v_owner <> v_caller) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  v_key := private.book_work_key(p_book);
  if v_key is null then
    raise exception 'notes_unavailable' using errcode = '22023';
  end if;
  return private.notes_page(v_caller, v_key, (private.notes_room_for(p_book)).id);
end;
$$;

-- The Book page's Notes lines: friends = visible live notes by her mutual friends (friends or public
-- level); public = public notes by members who are not her friends, only while Everyone is on. Her own
-- never counted. Zeros when there is no room (or no Notes for this Book).
create or replace function public.notes_summary(p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_room   uuid;
  v_on     boolean := private.notes_public_enabled();
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if found and v_owner is null then
    v_room := (private.notes_room_for(p_book)).id;
  end if;

  with v as materialized (
    select n.author_id, n.visibility, n.created_at, s.position
      from private.visible_notes(v_caller, v_room) n
      join public.room_sections s on s.id = n.section_id
     where n.deleted_at is null and n.author_id <> v_caller
  ),
  friends as (
    select f.followee_id as id
      from public.follows f
      join public.follows b on b.follower_id = f.followee_id and b.followee_id = f.follower_id
     where f.follower_id = v_caller and f.accepted_at is not null and b.accepted_at is not null
  ),
  fr as (select v.* from v where v.author_id in (select id from friends)),
  pub as (select v.* from v where v_on and v.visibility = 'public' and v.author_id not in (select id from friends)),
  fr_authors as (
    select a.author_id, max(a.created_at) as last from fr a group by a.author_id
  )
  select jsonb_build_object(
    'friends', jsonb_build_object(
      'count', (select count(*)::integer from fr),
      'authors', coalesce((select jsonb_agg(private.member_card(v_caller, x.author_id) order by x.last desc, x.author_id)
                             from (select * from fr_authors order by last desc, author_id limit 3) x), '[]'::jsonb),
      'authorCount', (select count(*)::integer from fr_authors),
      'firstChapter', (select min(position) from fr),
      'lastChapter', (select max(position) from fr)),
    'public', jsonb_build_object(
      'count', (select count(*)::integer from pub),
      'authorCount', (select count(distinct author_id)::integer from pub)))
    into v_out;
  return v_out;
end;
$$;

-- Make the Book's chapters, once: a room for its Work with p_count parts and The whole book.
create or replace function public.set_book_chapters(p_book uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_key    text;
  v_room   uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if not found or (v_owner is not null and v_owner <> v_caller) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  v_key := private.book_work_key(p_book);
  if v_key is null then
    raise exception 'notes_unavailable' using errcode = '22023';
  end if;
  if p_count is null or p_count not between 1 and 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  if not private.has_work(v_caller, v_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;

  -- Two at once: the second waits here and then finds the first's room.
  perform private.notes_lock('notes_work', v_key);
  if (private.notes_room_for(p_book)).id is not null then
    raise exception 'chapters_already_set' using errcode = 'PT409';
  end if;
  perform private.note_rate(v_caller, 'chapters', 20, interval '1 day');

  insert into public.rooms (kind, work_key, book_id, chapters_set_by)
  values ('notes', v_key, p_book, v_caller)
  returning id into v_room;
  insert into public.room_sections (room_id, position, kind)
  select v_room, k::smallint, 'part' from generate_series(1, p_count) k
  union all
  select v_room, (p_count + 1)::smallint, 'end';

  return private.notes_page(v_caller, v_key, v_room);
end;
$$;

-- Add p_count chapters at the end (before The whole book); existing chapters keep their ids and notes.
create or replace function public.add_book_chapters(p_room uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;
  -- Bounded before any arithmetic: a huge count is invalid_count, never an integer overflow.
  if p_count is null or p_count not between 1 and 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;

  perform private.notes_lock('notes_room', p_room::text);
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';
  if v_parts + p_count > 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  perform private.note_rate(v_caller, 'chapters', 20, interval '1 day');

  update public.room_sections set position = (v_parts + p_count + 1)::smallint
   where room_id = p_room and kind = 'end';
  insert into public.room_sections (room_id, position, kind)
  select p_room, k::smallint, 'part' from generate_series(v_parts + 1, v_parts + p_count) k;

  return private.notes_page(v_caller, v_room.work_key, p_room);
end;
$$;

-- The owner mends a wrong chapter count: p_count chapters (1..300), added or removed at the end, never
-- below the highest chapter that holds a note (deleted or not, anyone's). Logged. Only the owner may ask,
-- so the answer about notes she may not see tells no member anything.
create or replace function public.owner_set_chapter_count(p_room uuid, p_count integer)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_parts  integer;
  v_used   integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.notes_lock('notes_room', p_room::text);
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';
  select coalesce(max(s.position), 0)::integer into v_used
    from public.room_messages m
    join public.room_sections s on s.id = m.section_id
   where s.room_id = p_room and s.kind = 'part';
  if p_count < v_used then
    raise exception 'chapter_has_notes' using errcode = 'PT409';
  end if;

  if p_count > v_parts then
    update public.room_sections set position = (p_count + 1)::smallint where room_id = p_room and kind = 'end';
    insert into public.room_sections (room_id, position, kind)
    select p_room, k::smallint, 'part' from generate_series(v_parts + 1, p_count) k;
  elsif p_count < v_parts then
    delete from public.room_sections where room_id = p_room and kind = 'part' and position > p_count;
    update public.room_sections set position = (p_count + 1)::smallint where room_id = p_room and kind = 'end';
  end if;
  if p_count <> v_parts then
    insert into private.note_moderation_log (action, room_id, removed_by, reason)
    values ('chapter_count', p_room, v_caller, format('chapters %s -> %s', v_parts, p_count));
  end if;

  return jsonb_build_object('chapterCount', p_count, 'was', v_parts);
end;
$$;

-- Her chapter by hand: p_chapter 1..n, or p_finished; neither = Automatic again. Answers note_chapter.
create or replace function public.set_note_chapter(p_room uuid, p_chapter integer, p_finished boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  if coalesce(p_finished, false) then
    insert into public.note_positions as p (room_id, member_id, hand_chapter, hand_finished, updated_at)
    values (p_room, v_caller, null, true, now())
    on conflict (room_id, member_id) do update set hand_chapter = null, hand_finished = true, updated_at = now();
  elsif p_chapter is null then
    delete from public.note_positions where room_id = p_room and member_id = v_caller;
  elsif p_chapter between 1 and v_parts then
    insert into public.note_positions as p (room_id, member_id, hand_chapter, hand_finished, updated_at)
    values (p_room, v_caller, p_chapter::smallint, false, now())
    on conflict (room_id, member_id) do update set hand_chapter = excluded.hand_chapter, hand_finished = false,
                                                  updated_at = now();
  else
    raise exception 'invalid_chapter' using errcode = '22023';
  end if;

  return private.note_chapter(v_caller, p_room);
end;
$$;

-- The notes of one chapter she may see, newest first, p_limit (1..100, default 50) before p_before.
create or replace function public.note_messages(p_room uuid, p_section uuid, p_before timestamptz default null,
                                                p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sections s
                   join public.rooms r on r.id = s.room_id
                  where s.id = p_section and s.room_id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  return coalesce((
    select jsonb_agg(private.note_json(v_caller, m) order by m.created_at desc, m.id desc)
      from (select n.*
              from private.visible_notes(v_caller, p_room) n
             where n.section_id = p_section
               and (p_before is null or n.created_at < p_before)
             order by n.created_at desc, n.id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
  ), '[]'::jsonb);
end;
$$;

-- Write a note (or a reply) in a chapter, at a level of her choice. Idempotent on (author, client id).
create or replace function public.post_note(p_room uuid, p_section uuid, p_client_id uuid, p_body text,
                                            p_visibility text, p_reply_to uuid default null,
                                            p_spoiler boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_row    public.room_messages;
  v_parent public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'friends', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  if p_body is null or p_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
    raise exception 'body_empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  perform private.notes_lock('notes', v_caller::text);

  -- A retry: the note it made (as she sees it now).
  select * into v_row from public.room_messages m where m.author_id = v_caller and m.client_id = p_client_id;
  if found then
    if v_row.room_id is distinct from p_room or v_row.section_id is distinct from p_section then
      raise exception 'client_id_reused' using errcode = 'PT409';
    end if;
    return private.note_json(v_caller, v_row);
  end if;

  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;
  if p_visibility = 'public' and not private.notes_public_enabled() then
    raise exception 'notes_public_off' using errcode = 'PT409';
  end if;

  -- The room's lock: the chapter, the parent's level and the thread's newest time are read after it.
  perform private.notes_lock('notes_room', p_room::text);
  if not exists (select 1 from public.room_sections s where s.id = p_section and s.room_id = p_room) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_reply_to is not null then
    select * into v_parent from public.room_messages m where m.id = p_reply_to;
    if not found or v_parent.room_id <> p_room or v_parent.section_id is distinct from p_section
       or v_parent.deleted_at is not null or not private.can_see_note(v_caller, v_parent.id) then
      raise exception 'reply_not_visible' using errcode = '22023';
    end if;
    if private.note_level(p_visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
  end if;

  -- 30 a minute and 300 a day over all Books. Under her member lock.
  if (select count(*) from public.room_messages m
       where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.room_messages m
          where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  -- Every move to Everyone is one use of her 30 a day (a post here, a widening in set_note_visibility).
  if p_visibility = 'public' then
    perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
  end if;

  insert into public.room_messages (room_id, section_id, author_id, client_id, body, reply_to, spoiler,
                                    visibility, created_at)
  values (p_room, p_section, v_caller, p_client_id, p_body, p_reply_to, coalesce(p_spoiler, false),
          p_visibility,
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.room_messages m where m.section_id = p_section)))
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$$;

-- Her note's level. Narrowing narrows every reply under it that is now wider (any author, all the way
-- down); widening goes up to the parent's level, to public only while Everyone is on; replies are never
-- widened with it.
create or replace function public.set_note_visibility(p_note uuid, p_visibility text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
  v_parent text;
  v_level  integer := private.note_level(p_visibility);
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_level is null then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller and m.deleted_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.notes_lock('notes_room', v_row.room_id::text);
  select m.* into v_row from public.room_messages m where m.id = p_note for update;
  if v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if v_level < private.note_level(v_row.visibility) then
    -- Narrowing: the replies first (each to the narrower of its level and the new one), then the note.
    with recursive d as (
      select m.id from public.room_messages m where m.reply_to = p_note
      union
      select m.id from public.room_messages m join d on m.reply_to = d.id
    )
    update public.room_messages m set visibility = p_visibility
      from d
     where m.id = d.id and private.note_level(m.visibility) > v_level;
  elsif v_level > private.note_level(v_row.visibility) then
    if p_visibility = 'public' and not private.notes_public_enabled() then
      raise exception 'notes_public_off' using errcode = 'PT409';
    end if;
    select p.visibility into v_parent from public.room_messages p where p.id = v_row.reply_to;
    if v_parent is not null and v_level > private.note_level(v_parent) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
    -- Every move to Everyone is one use of her 30 a day, whenever the note was written: narrowing and
    -- widening again uses another.
    if p_visibility = 'public' then
      perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
    end if;
  end if;

  update public.room_messages set visibility = p_visibility where id = p_note and visibility <> p_visibility
  returning * into v_row;
  if not found then
    select * into v_row from public.room_messages m where m.id = p_note;
  end if;
  return private.note_json(v_caller, v_row);
end;
$$;

-- One reaction per member and note: an emoji sets it, the same again or null removes it.
create or replace function public.react_to_note(p_note uuid, p_emoji text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
  v_old    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('❤️', '😂', '😮', '😢', '🔥', '📚') then
    raise exception 'invalid_emoji' using errcode = '22023';
  end if;
  select * into v_row from public.room_messages m where m.id = p_note;
  if not found or v_row.deleted_at is not null or not private.can_see_note(v_caller, p_note) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.note_rate(v_caller, 'react', 60, interval '1 minute');

  select r.emoji into v_old from public.room_reactions r where r.message_id = p_note and r.member_id = v_caller;
  if p_emoji is null or p_emoji = v_old then
    delete from public.room_reactions where message_id = p_note and member_id = v_caller;
  elsif v_old is null then
    insert into public.room_reactions (message_id, member_id, emoji) values (p_note, v_caller, p_emoji)
    on conflict (message_id, member_id) do update set emoji = excluded.emoji, created_at = clock_timestamp();
  else
    update public.room_reactions set emoji = p_emoji, created_at = clock_timestamp()
     where message_id = p_note and member_id = v_caller;
  end if;
  return private.note_json(v_caller, v_row);
end;
$$;

-- Her own note becomes a tombstone ("Note removed"): its text and reactions go, its level stays.
create or replace function public.delete_note(p_note uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller
   for update of m;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.deleted_at is null then
    delete from public.room_reactions where message_id = p_note;
    update public.room_messages set body = '', deleted_at = clock_timestamp(), deleted_by = v_caller
     where id = p_note
    returning * into v_row;
  end if;
  return private.note_json(v_caller, v_row);
end;
$$;

-- Report a note she can see to the owner's Feedback inbox: one feedback row (kind report), once per
-- reporter and note, under the feedback limiter.
create or replace function public.report_note(p_note uuid, p_reason text, p_text text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller  uuid := auth.uid();
  v_text    text := nullif(btrim(coalesce(p_text, ''), E' \t\n\r'), '');
  v_row     public.room_messages;
  v_chapter smallint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'report_text_too_long' using errcode = '22023';
  end if;
  select * into v_row from public.room_messages m where m.id = p_note;
  if not found or v_row.deleted_at is not null or not private.can_see_note(v_caller, p_note) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.author_id = v_caller then
    raise exception 'report_self' using errcode = '22023';
  end if;

  -- Reported before: her first report stands. Under her lock, so two at once make one row.
  perform private.notes_lock('notes', v_caller::text);
  if exists (select 1 from public.feedback f
              where f.member_id = v_caller and f.kind = 'report' and f.context ->> 'note' = p_note::text) then
    return jsonb_build_object('reported', true);
  end if;

  select s.position into v_chapter from public.room_sections s where s.id = v_row.section_id;
  insert into public.feedback (member_id, kind, body, context)
  values (v_caller, 'report',
          'Notes report: ' || p_reason || coalesce(E'\n\n' || v_text, ''),
          jsonb_build_object(
            'room', v_row.room_id,
            'chapter', v_chapter,
            'section', v_row.section_id,
            'note', v_row.id,
            'author', v_row.author_id,
            'visibility', v_row.visibility,
            'excerpt', left(v_row.body, 300)));
  return jsonb_build_object('reported', true);
end;
$$;

-- Her cursor in a chapter, forward only, never past the thread's newest note.
create or replace function public.mark_notes_read(p_room uuid, p_section uuid, p_until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_to     timestamptz;
  v_at     timestamptz;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sections s
                   join public.rooms r on r.id = s.room_id
                  where s.id = p_section and s.room_id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  v_to := greatest(clock_timestamp(), (select max(m.created_at) from public.room_messages m where m.section_id = p_section));
  v_to := least(coalesce(p_until, v_to), v_to);

  insert into public.room_cursors as c (section_id, member_id, last_read_at)
  values (p_section, v_caller, v_to)
  on conflict (section_id, member_id)
    do update set last_read_at = greatest(c.last_read_at, excluded.last_read_at)
  returning c.last_read_at into v_at;
  return jsonb_build_object('lastReadAt', v_at);
end;
$$;

-- The owner turns Everyone on or off.
create or replace function public.owner_set_notes_public(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid_value' using errcode = '22023';
  end if;
  insert into private.notes_settings as s (id, public_enabled, updated_at) values (true, p_enabled, now())
  on conflict (id) do update set public_enabled = excluded.public_enabled, updated_at = now();
  return jsonb_build_object('publicEnabled', private.notes_public_enabled());
end;
$$;

-- The owner removes a note after a report: the record first (text, level, reason), then the tombstone
-- ("Removed by the moderator") for everyone; its reactions go.
create or replace function public.owner_remove_note(p_note uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r'), '');
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes'
   for update of m;
  if not found or v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  insert into private.note_moderation_log (message_id, room_id, author_id, removed_by, reason, body, visibility)
  values (v_row.id, v_row.room_id, v_row.author_id, v_caller, v_reason, v_row.body, v_row.visibility);
  delete from public.room_reactions where message_id = p_note;
  update public.room_messages
     set body = '', deleted_at = clock_timestamp(), deleted_by = v_caller, moderated = true
   where id = p_note;
  return jsonb_build_object('removed', true);
end;
$$;

-- -------------------------------------------------------------------------- the two shipped functions

-- public.block: the body of 20261113050000_block_co_member.sql, its guard gaining
-- "or private.note_author_seen(caller, target)". Same signature, security definer, search_path, grants.
create or replace function public.block(p_member uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_member is not distinct from v_caller then
    raise exception 'follow_self' using errcode = '22023';
  end if;
  if private.reachable(v_caller, p_member) is not true
     and private.buddy_co_members(v_caller, p_member) is not true
     and private.note_author_seen(v_caller, p_member) is not true
     and not exists (select 1 from public.blocks where blocker_id = v_caller and blocked_id = p_member) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, p_member)::text || greatest(v_caller, p_member)::text, 0));

  delete from public.follows
   where (follower_id = v_caller and followee_id = p_member)
      or (follower_id = p_member and followee_id = v_caller);
  insert into public.blocks (blocker_id, blocked_id)
  values (v_caller, p_member)
  on conflict do nothing;
  delete from public.follow_link_views
   where (visitor_id = v_caller and member_id = p_member)
      or (visitor_id = p_member and member_id = v_caller);
end;
$$;

-- private.can_see_photo: the body of 20261113010000_buddy_reads.sql, gaining "or private.note_photo_seen":
-- while Everyone is on, the owner has a live public note the caller can see (decision 22; blocks through
-- private.can_see_note).
create or replace function private.can_see_photo(p_caller uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_caller is not null and p_owner is not null
     and (p_caller = p_owner
          or private.reachable(p_caller, p_owner)
          or private.buddy_co_members(p_caller, p_owner)
          or private.note_photo_seen(p_caller, p_owner))
$$;

-- -------------------------------------------------------------------------- grants

-- Helpers: nobody but the functions above (the private schema is not granted to the API roles either).
revoke all on function private.note_level(text) from public, anon, authenticated;
revoke all on function private.book_work_key(uuid) from public, anon, authenticated;
revoke all on function private.work_books(text) from public, anon, authenticated;
revoke all on function private.notes_room_for(uuid) from public, anon, authenticated;
revoke all on function private.has_work(uuid, text) from public, anon, authenticated;
revoke all on function private.mutual_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function private.notes_public_enabled() from public, anon, authenticated;
revoke all on function private.can_see_note(uuid, uuid) from public, anon, authenticated;
revoke all on function private.visible_notes(uuid, uuid) from public, anon, authenticated;
revoke all on function private.note_chapter(uuid, uuid) from public, anon, authenticated;
revoke all on function private.note_quote(uuid, uuid) from public, anon, authenticated;
revoke all on function private.note_json(uuid, public.room_messages) from public, anon, authenticated;
revoke all on function private.notes_page(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.notes_lock(text, text) from public, anon, authenticated;
revoke all on function private.note_rate(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.note_author_seen(uuid, uuid) from public, anon, authenticated;
revoke all on function private.note_photo_seen(uuid, uuid) from public, anon, authenticated;
revoke all on function private.purge_note_moderation_log() from public, anon, authenticated;
revoke all on function private.room_messages_check() from public, anon, authenticated;
revoke all on function private.room_messages_replies_check() from public, anon, authenticated;
revoke all on function private.room_sections_order() from public, anon, authenticated;

-- RPCs: signed-in members only.
revoke all on function public.notes_config() from public, anon;
revoke all on function public.book_notes(uuid) from public, anon;
revoke all on function public.notes_summary(uuid) from public, anon;
revoke all on function public.set_book_chapters(uuid, integer) from public, anon;
revoke all on function public.add_book_chapters(uuid, integer) from public, anon;
revoke all on function public.owner_set_chapter_count(uuid, integer) from public, anon;
revoke all on function public.set_note_chapter(uuid, integer, boolean) from public, anon;
revoke all on function public.note_messages(uuid, uuid, timestamptz, integer) from public, anon;
revoke all on function public.post_note(uuid, uuid, uuid, text, text, uuid, boolean) from public, anon;
revoke all on function public.set_note_visibility(uuid, text) from public, anon;
revoke all on function public.react_to_note(uuid, text) from public, anon;
revoke all on function public.delete_note(uuid) from public, anon;
revoke all on function public.report_note(uuid, text, text) from public, anon;
revoke all on function public.mark_notes_read(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.owner_set_notes_public(boolean) from public, anon;
revoke all on function public.owner_remove_note(uuid, text) from public, anon;
grant execute on function public.notes_config() to authenticated;
grant execute on function public.book_notes(uuid) to authenticated;
grant execute on function public.notes_summary(uuid) to authenticated;
grant execute on function public.set_book_chapters(uuid, integer) to authenticated;
grant execute on function public.add_book_chapters(uuid, integer) to authenticated;
grant execute on function public.owner_set_chapter_count(uuid, integer) to authenticated;
grant execute on function public.set_note_chapter(uuid, integer, boolean) to authenticated;
grant execute on function public.note_messages(uuid, uuid, timestamptz, integer) to authenticated;
grant execute on function public.post_note(uuid, uuid, uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.set_note_visibility(uuid, text) to authenticated;
grant execute on function public.react_to_note(uuid, text) to authenticated;
grant execute on function public.delete_note(uuid) to authenticated;
grant execute on function public.report_note(uuid, text, text) to authenticated;
grant execute on function public.mark_notes_read(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.owner_set_notes_public(boolean) to authenticated;
grant execute on function public.owner_remove_note(uuid, text) to authenticated;

-- -------------------------------------------------------------------------- cron

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): private.purge_note_moderation_log() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: private.purge_note_moderation_log() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      perform cron.schedule('purge-note-moderation-log', '40 3 1 * *', 'select private.purge_note_moderation_log()');
    exception when others then
      raise notice 'pg_cron is there but the job could not be scheduled (%): private.purge_note_moderation_log() is not scheduled', sqlerrm;
    end;
  end if;
end;
$$;
