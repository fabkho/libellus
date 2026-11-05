-- Buddy reads, D3: messages, reactions, delete, reports, read cursors (docs/plans/buddy-read-shared.md
-- parts 4.1, 4.3 and 4.5, items 1 to 32).
--
-- The talking in a buddy read: one room thread ("Before we start", section_id null) and one thread per
-- Section. A joined member posts text or a GIF from KLIPY, answers a message of the same thread, marks a
-- Section comment as a spoiler, reacts with one of six emoji (one reaction per member and message),
-- deletes her own message (the host any) as a tombstone, and reports a message to the instance owner's
-- feedback inbox. Each member has a read cursor per thread, so the screens can show what is new.
--
-- What this migration adds:
--   tables   public.buddy_messages, public.buddy_reactions, public.buddy_section_cursors.
--            RLS on, no policies, nothing granted to anon or authenticated: every read and write is one
--            of the functions below. The room's cursor is D1's buddy_read_members.last_read_at.
--   helpers  private.buddy_rate_window (a limit per window, next to D1's hourly private.buddy_rate),
--            private.buddy_hidden (the block test between a message's author and the caller),
--            private.buddy_message_json, private.buddy_reactions_json, private.buddy_message_for,
--            private.buddy_counts, private.buddy_unread (the cursor and unread counters),
--            the trigger private.buddy_cursors_gone (a member out of a read: her Section cursors go).
--   RPCs     post_buddy_message, buddy_read_messages, react_to_buddy_message, delete_buddy_message,
--            mark_buddy_read, report_buddy_message.
--   changes  four of D1's functions, each body copied from 20261113010000_buddy_reads.sql and changed
--            only where said: buddy_read (each Section's count and unread, and the room's as
--            `room: {count, unread}`), my_buddy_reads (unread, over the room and only the Sections she may
--            open, so a number never tells of a veiled Section), leave_buddy_read (p_delete_messages
--            deletes her messages and her reactions in that read), set_buddy_sections (replacing the division is refused
--            as buddy_sections_locked once a Section thread has a message, a tombstone included, because
--            it deletes the Sections and their messages with them; a rename stays free).
--            public.feedback: the kind check gains 'report' (a step of its own below; the feedback
--            migration is not edited), and the members' insert policy refuses kind 'report', so a report
--            only ever comes from report_buddy_message with a context the database wrote.
--
-- What every member gets: every message of the read, Section threads included, whatever her Section:
-- the veil is drawn by the app (Q8, plan part 5.4), not by the database. Nothing here holds or answers a
-- page, a percent or a fraction. A block between two members removes nothing: each stops seeing the
-- other's messages and reactions, and cannot answer, react to or report them (both ways; her own she
-- always sees); the host deletes any message of her room, blocked or not, and a reply_to that points
-- at a hidden message reads null. A member who left keeps her messages and reactions, under her name
-- (private.member_name works for a member who left), unless she left with p_delete_messages: the choice
-- to delete is made when leaving; after that only account deletion removes them. A tombstone reads as
-- kind 'text' with deleted_at set (a deleted GIF does not say it was one). A report is once per reporter
-- and message. Her account deleted: her messages,
-- her reactions and her cursors go with it (the foreign keys cascade); a reply to one of her messages
-- keeps its text and loses the link (reply_to set null).
--
-- What it leaves out: the Realtime policy and triggers (D4); photos (kind 'image', X3); push; the web;
-- the owner screen's label for a report (W4: web/app/data/feedback.ts reads an unknown kind as 'other',
-- so the inbox stays safe until then). The Section of a message and the message answered are checked to
-- be of the same read (and the same thread) by post_buddy_message under the read's lock, not by a
-- constraint: a check cannot read another table, and a composite foreign key would need a new unique key
-- on D1's buddy_read_sections, which this migration leaves as it is.
--
-- Refusals, as stable messages (the client maps by message): not_signed_in 42501; not_found PT404 (no
-- such read or message, not a joined member, a message across a block: one answer); PT409
-- buddy_read_archived (no new message or reaction), buddy_sections_locked, message_client_id_reused,
-- message_unavailable (a tombstone: no reaction, no report); PT403 message_not_yours (delete: neither
-- the author nor the host); PT429 message_rate_limited (30 messages a minute, 600 a day), rate_limited
-- (60 reactions a minute; a report over the feedback limit of 5 an hour and 20 a day, which its trigger
-- private.feedback_rate_limit() raises by itself); 22023 message_client_id_required,
-- buddy_section_invalid (a Section of another read), message_kind_invalid, message_body_invalid,
-- message_gif_invalid, message_spoiler_unavailable (a spoiler outside a Section),
-- message_reply_unavailable (another thread, a tombstone, across a block, not there),
-- message_emoji_invalid, report_reason_invalid, report_note_too_long, report_self.
--
-- Order: a message's created_at is greatest(clock_timestamp(), the read's newest created_at + 1 µs),
-- worked out under the read's lock, so two messages of one transaction have distinct, increasing times
-- and a message never sorts before one written earlier. Never now().
--
-- Lock order (D1's, extended; advisory, transaction scoped, always in this order and never back):
--   1. the caller's member lock  hashtextextended('buddy:' || member, 0)       her message limits and
--                                                                              her client ids;
--   2. the read's lock           hashtextextended('buddy_read:' || read, 0)   every change to a read's
--                                                                              rows, the gate again;
--   3. row locks (the message deleted or reacted to);
--   4. leaf locks, taken last and holding nothing after them: the window limiter's
--      hashtextextended('buddy_rate:' || member || ':' || kind, 0) and the feedback trigger's
--      hashtextextended('feedback:' || member, 0).
-- post_buddy_message takes 1, looks up her client id (a retry answers its first row, also after she
-- left), checks the gate, then takes 2 and checks the gate again: a poster who passed the first check
-- while the host's removal (or her own leave) held 2 is refused after it, not written after she was
-- gone. react_to_buddy_message, delete_buddy_message, mark_buddy_read and report_buddy_message take 2
-- only, then their row (mark_buddy_read none when the cursor would not move); the reads
-- (buddy_read_messages, buddy_read, my_buddy_reads) take none.
--
-- Limits: posts 30 a minute and 600 a day, reactions 60 a minute, reports by the feedback limiter.
-- Deletes and cursors have none: a delete ends at most one message and a tombstone stays one; a cursor
-- call writes at most her one row, sends nothing, and answers before the lock when it would not move.
--
-- Changes to the plan's part 4 (the PR says why): the six RPCs keep the plan's signatures; refusals the
-- plan did not name are added in its style (above); a member out of a read (left, removed, declined, her
-- account gone) loses her Section cursors by trigger, not only when she leaves; leave_buddy_read with
-- p_delete_messages deletes her reactions in the read too; the members' feedback insert policy refuses
-- kind 'report'; a report is idempotent per reporter and message.

-- -------------------------------------------------------------------------- tables

create table public.buddy_messages (
  id            uuid primary key default gen_random_uuid(),
  buddy_read_id uuid not null references public.buddy_reads (id) on delete cascade,
  section_id    uuid references public.buddy_read_sections (id) on delete cascade,
  author_id     uuid not null references auth.users (id) on delete cascade,
  client_id     uuid not null,
  kind          text not null default 'text',
  body          text not null default '',
  media_url     text,
  media_width   integer,
  media_height  integer,
  reply_to      uuid references public.buddy_messages (id) on delete set null,
  spoiler       boolean not null default false,
  created_at    timestamptz not null default clock_timestamp(),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users (id) on delete set null,
  unique (author_id, client_id),
  constraint buddy_messages_kind check (kind in ('text', 'gif')),
  constraint buddy_messages_body_length check (char_length(body) <= 2000),
  -- A tombstone keeps nothing it said; a live text has something visible; a GIF is KLIPY's, with a size.
  constraint buddy_messages_shape check (coalesce(
    case
      when deleted_at is not null
        then body = '' and media_url is null and media_width is null and media_height is null
      when kind = 'text'
        then char_length(body) >= 1 and body ~ '[^[:space:][:cntrl:]\u00a0\u200b]'
             and media_url is null and media_width is null and media_height is null
      when kind = 'gif'
        then char_length(media_url) <= 500
             and media_url ~ '^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$'
             and media_width between 1 and 10000 and media_height between 1 and 10000
      else false
    end, false)),
  constraint buddy_messages_spoiler check (not spoiler or section_id is not null),
  constraint buddy_messages_deleted_by check (deleted_by is null or deleted_at is not null)
);

create index buddy_messages_read on public.buddy_messages (buddy_read_id, created_at desc, id desc);
create index buddy_messages_room on public.buddy_messages (buddy_read_id, created_at desc) where section_id is null;
create index buddy_messages_section on public.buddy_messages (section_id, created_at desc) where section_id is not null;
create index buddy_messages_author on public.buddy_messages (author_id, created_at desc);
create index buddy_messages_reply_to on public.buddy_messages (reply_to) where reply_to is not null;
create index buddy_messages_deleted_by on public.buddy_messages (deleted_by) where deleted_by is not null;

comment on table public.buddy_messages is
  'Buddy reads (20261113030000): the messages of a read. section_id null = the room thread, else a Section''s '
  'thread (of the same read, checked by post_buddy_message). kind text or gif (a KLIPY address). deleted_at set = '
  'a tombstone: no body, no media. created_at is clock order per read, never before an earlier message. Read and '
  'written only through the buddy read functions.';

create table public.buddy_reactions (
  message_id uuid not null references public.buddy_messages (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('❤️', '😂', '😮', '😢', '🔥', '📚')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (message_id, member_id)
);

create index buddy_reactions_member on public.buddy_reactions (member_id);

comment on table public.buddy_reactions is
  'Buddy reads: one reaction per member and message, one of six emoji. Written only by react_to_buddy_message.';

create table public.buddy_section_cursors (
  section_id   uuid not null references public.buddy_read_sections (id) on delete cascade,
  member_id    uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (section_id, member_id)
);

create index buddy_section_cursors_member on public.buddy_section_cursors (member_id);

comment on table public.buddy_section_cursors is
  'Buddy reads: how far a member has read a Section''s thread (only forward, mark_buddy_read). The room''s '
  'cursor is buddy_read_members.last_read_at.';

alter table public.buddy_messages enable row level security;
alter table public.buddy_reactions enable row level security;
alter table public.buddy_section_cursors enable row level security;

-- Supabase grants every new public table to the API roles; these want none. No policies either.
revoke all on public.buddy_messages from anon, authenticated;
revoke all on public.buddy_reactions from anon, authenticated;
revoke all on public.buddy_section_cursors from anon, authenticated;

-- -------------------------------------------------------------------------- feedback: reports

-- A report is a feedback row of its own kind. A step of its own, so the feedback migration stays as it was.
alter table public.feedback drop constraint feedback_kind;
alter table public.feedback add constraint feedback_kind check (kind in ('bug', 'feature', 'other', 'report'));

-- A member still inserts her own bug, feature or other message; a report only report_buddy_message
-- writes (its context names a message, which a member must not be able to make up).
drop policy feedback_insert_own on public.feedback;
create policy feedback_insert_own on public.feedback
  for insert to authenticated
  with check (member_id = (select auth.uid()) and kind is distinct from 'report');

-- -------------------------------------------------------------------------- helpers

-- A limit of p_limit calls of one kind per p_window, counted in private.buddy_calls: forget her calls of
-- that kind older than the window, refuse at the limit (rate_limited PT429), count this one. D1's
-- private.buddy_rate counts per hour under her member lock; this one is for calls that take the read's
-- lock only (reactions), so it takes a leaf lock of its own (lock 4 of the header): two calls at once
-- cannot both slip under the limit.
create or replace function private.buddy_rate_window(p_member uuid, p_kind text, p_limit integer, p_window interval)
returns void
language plpgsql
set search_path = pg_catalog, private
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy_rate:' || p_member::text || ':' || p_kind, 0));
  delete from private.buddy_calls
   where member_id = p_member and kind = p_kind and at < now() - p_window;
  if (select count(*) from private.buddy_calls
       where member_id = p_member and kind = p_kind and at > now() - p_window) >= p_limit then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  insert into private.buddy_calls (member_id, kind) values (p_member, p_kind);
end;
$$;

-- A message (or a reaction) of p_author is hidden from p_caller: someone else, blocked either way.
create or replace function private.buddy_hidden(p_caller uuid, p_author uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select p_author is distinct from p_caller and private.blocked_either(p_caller, p_author)
$$;

-- A message's reactions as p_caller sees them: per emoji, how many and whether one is hers, in the
-- order of the bar; a reaction of someone blocked with her (either way) is left out.
create or replace function private.buddy_reactions_json(p_caller uuid, p_message uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine)
                            order by array_position(array['❤️', '😂', '😮', '😢', '🔥', '📚'], x.emoji)), '[]'::jsonb)
    from (select r.emoji, count(*)::integer as n, bool_or(r.member_id = p_caller) as mine
            from public.buddy_reactions r
           where r.message_id = p_message and not private.buddy_hidden(p_caller, r.member_id)
           group by r.emoji) x
$$;

-- A message as the API answers it. A tombstone carries no body and no media (and no reactions: they
-- were deleted with it), and its kind reads 'text': deleted_at is what marks it, and a deleted GIF
-- does not say it was a GIF. reply_to is null when the message answered is one she is not shown
-- (its author is blocked with her either way), so a hidden message's id never reaches her.
create or replace function private.buddy_message_json(p_caller uuid, p_message public.buddy_messages)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', p_message.id,
    'section_id', p_message.section_id,
    'author', jsonb_build_object('id', p_message.author_id, 'name', private.member_name(p_message.author_id)),
    'client_id', p_message.client_id,
    'kind', case when p_message.deleted_at is null then p_message.kind else 'text' end,
    'body', case when p_message.deleted_at is null then p_message.body end,
    'media_url', case when p_message.deleted_at is null then p_message.media_url end,
    'media_width', case when p_message.deleted_at is null then p_message.media_width end,
    'media_height', case when p_message.deleted_at is null then p_message.media_height end,
    'reply_to', (select r.id from public.buddy_messages r
                  where r.id = p_message.reply_to and not private.buddy_hidden(p_caller, r.author_id)),
    'spoiler', p_message.spoiler,
    'created_at', p_message.created_at,
    'deleted_at', p_message.deleted_at,
    'reactions', case when p_message.deleted_at is null
                      then private.buddy_reactions_json(p_caller, p_message.id) else '[]'::jsonb end
  )
$$;

-- The message a reaction, a delete or a report is about, for a joined member of its read who may see
-- it, after the read's lock (lock 2) and with the row locked (3): not_found for no such message, a
-- member of another read, or an author blocked with her either way. With p_as_host the block does
-- not hide it from the read's host (her row checked after the lock): a host moderating her room
-- deletes what a member wrote there, also from someone she blocked.
create or replace function private.buddy_message_for(p_message uuid, p_caller uuid, p_as_host boolean default false)
returns public.buddy_messages
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_read uuid;
  v_me   public.buddy_read_members;
  v_row  public.buddy_messages;
begin
  select buddy_read_id into v_read from public.buddy_messages where id = p_message;
  if v_read is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.buddy_gate(v_read, p_caller);
  perform private.buddy_lock_read(v_read);
  v_me := private.buddy_gate(v_read, p_caller);
  select * into v_row from public.buddy_messages where id = p_message for update;
  if not found
     or (private.buddy_hidden(p_caller, v_row.author_id) and not (p_as_host and v_me.role = 'host')) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  return v_row;
end;
$$;

-- Per thread of a read (section_id null = the room), for a joined member: the messages she is shown
-- that are not tombstones (her own and those of anyone not blocked with her), and how many of them
-- are someone else's and newer than her cursor (the room's: her member row's last_read_at; a Section's:
-- her row in buddy_section_cursors; without a cursor, since she joined).
create or replace function private.buddy_counts(p_read uuid, p_caller uuid)
returns table (section_id uuid, total integer, unread integer)
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with me as (
    select m.joined_at, m.last_read_at
      from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.member_id = p_caller and m.joined_at is not null
  ), hidden as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = p_caller
    union
    select b.blocker_id from public.blocks b where b.blocked_id = p_caller
  )
  select x.section_id,
         count(*)::integer,
         (count(*) filter (
            where x.author_id <> p_caller
              and x.created_at > coalesce(case when x.section_id is null then me.last_read_at else c.last_read_at end,
                                          me.joined_at)))::integer
    from public.buddy_messages x
    cross join me
    left join public.buddy_section_cursors c on c.section_id = x.section_id and c.member_id = p_caller
   where x.buddy_read_id = p_read
     and x.deleted_at is null
     and x.author_id not in (select h.id from hidden h)
   group by x.section_id
$$;

-- Her unread messages in a read, over the threads she may open: the room, every part up to her Section
-- (position <= read_through) and the end Section once every part is read. A veiled Section's activity
-- never shows in this number. Cheap: it reads only the open threads and, in each, only what is newer
-- than her cursor there (the index ranges buddy_messages_read and buddy_messages_section), never the
-- read's whole history; my_buddy_reads calls it once per read.
create or replace function private.buddy_unread(p_read uuid, p_caller uuid)
returns integer
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with me as (
    select m.joined_at, m.last_read_at, m.read_through, private.buddy_parts(p_read) as parts
      from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.member_id = p_caller and m.joined_at is not null
  ), hidden as (
    select coalesce(array_agg(h.id), '{}') as ids
      from (select b.blocked_id as id from public.blocks b where b.blocker_id = p_caller
            union
            select b.blocker_id from public.blocks b where b.blocked_id = p_caller) h
  ), open as (
    select s.id, coalesce(c.last_read_at, me.joined_at) as since
      from public.buddy_read_sections s
      cross join me
      left join public.buddy_section_cursors c on c.section_id = s.id and c.member_id = p_caller
     where s.buddy_read_id = p_read
       and ((s.kind = 'part' and s.position <= me.read_through)
            or (s.kind = 'end' and me.read_through >= me.parts))
  )
  select ((select count(*)
             from public.buddy_messages x, me, hidden
            where x.buddy_read_id = p_read and x.section_id is null
              and x.created_at > coalesce(me.last_read_at, me.joined_at)
              and x.deleted_at is null and x.author_id <> p_caller and not (x.author_id = any (hidden.ids)))
        + (select count(*)
             from open o
             join public.buddy_messages x on x.section_id = o.id and x.created_at > o.since
             cross join hidden
            where x.deleted_at is null and x.author_id <> p_caller and not (x.author_id = any (hidden.ids))))::integer
$$;

-- ------------------------------------------------------------- the trigger: a member out, her cursors

-- After a member row is deleted (she left, was removed, declined, or her account went): her Section
-- cursors in that read go too. The room's cursor went with the row.
create or replace function private.buddy_cursors_gone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  delete from public.buddy_section_cursors c
   using public.buddy_read_sections s
   where s.id = c.section_id and s.buddy_read_id = old.buddy_read_id and c.member_id = old.member_id;
  return null;
end;
$$;

create trigger buddy_read_members_cursors_gone
  after delete on public.buddy_read_members
  for each row execute function private.buddy_cursors_gone();

-- ------------------------------------------------------------------------- the RPCs

-- Post a message in a read's room (p_section null) or in one of its Sections' threads. p_kind 'text'
-- (p_body, 1..2000 characters, something visible) or 'gif' (p_gif = {url, width, height}: KLIPY's
-- address, its size; p_body an optional caption). p_reply_to answers a live message of the same
-- thread; p_spoiler only in a Section. Idempotent on (her, p_client_id): the same call again answers
-- the message it made, whatever became of it or of her membership since; the same client id for
-- another read, thread or kind is message_client_id_reused. Answers the message as buddy_read_messages does.
create or replace function public.post_buddy_message(
  p_read uuid,
  p_section uuid,
  p_client_id uuid,
  p_kind text,
  p_body text,
  p_reply_to uuid default null,
  p_spoiler boolean default false,
  p_gif jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_row    public.buddy_messages;
  v_status text;
  v_body   text := coalesce(p_body, '');
  v_url    text;
  v_width  integer;
  v_height integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'message_client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- A retry: the message it made. Before the gate, so a retry after she left still gets its answer.
  select * into v_row from public.buddy_messages where author_id = v_caller and client_id = p_client_id;
  if found then
    if v_row.buddy_read_id is distinct from p_read or v_row.section_id is distinct from p_section
       or v_row.kind is distinct from p_kind then
      raise exception 'message_client_id_reused' using errcode = 'PT409';
    end if;
    return private.buddy_message_json(v_caller, v_row);
  end if;

  -- The gate, then the read's lock, then the gate again: a removal or a leave that held the lock while
  -- she passed the first check has happened by now, and she is refused instead of written after it.
  perform private.buddy_gate(p_read, v_caller);
  perform private.buddy_lock_read(p_read);
  perform private.buddy_gate(p_read, v_caller);

  select status into v_status from public.buddy_reads where id = p_read;
  if v_status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;
  if coalesce(p_spoiler, false) and p_section is null then
    raise exception 'message_spoiler_unavailable' using errcode = '22023';
  end if;

  if p_kind = 'text' then
    if p_gif is not null then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
    if char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
      raise exception 'message_body_invalid' using errcode = '22023';
    end if;
  elsif p_kind = 'gif' then
    if char_length(v_body) > 2000 then
      raise exception 'message_body_invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_gif) is distinct from 'object'
       or jsonb_typeof(p_gif -> 'url') is distinct from 'string'
       or jsonb_typeof(p_gif -> 'width') is distinct from 'number'
       or jsonb_typeof(p_gif -> 'height') is distinct from 'number'
       or (p_gif ->> 'width') !~ '^[0-9]{1,5}$' or (p_gif ->> 'height') !~ '^[0-9]{1,5}$' then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
    v_url := p_gif ->> 'url';
    v_width := (p_gif ->> 'width')::integer;
    v_height := (p_gif ->> 'height')::integer;
    if char_length(v_url) > 500
       or v_url !~ '^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$'
       or v_width not between 1 and 10000 or v_height not between 1 and 10000 then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
  else
    raise exception 'message_kind_invalid' using errcode = '22023';
  end if;

  -- An answer stays in its thread, to a live message she can see.
  if p_reply_to is not null and not exists (
    select 1 from public.buddy_messages r
     where r.id = p_reply_to and r.buddy_read_id = p_read and r.section_id is not distinct from p_section
       and r.deleted_at is null and not private.buddy_hidden(v_caller, r.author_id)
  ) then
    raise exception 'message_reply_unavailable' using errcode = '22023';
  end if;

  -- 30 a minute, 600 a day, over all her reads; under her member lock, so two at once cannot both pass.
  if (select count(*) from public.buddy_messages
       where author_id = v_caller and created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.buddy_messages
          where author_id = v_caller and created_at > clock_timestamp() - interval '1 day') >= 600 then
    raise exception 'message_rate_limited' using errcode = 'PT429';
  end if;

  insert into public.buddy_messages (buddy_read_id, section_id, author_id, client_id, kind, body,
                                     media_url, media_width, media_height, reply_to, spoiler, created_at)
  values (p_read, p_section, v_caller, p_client_id, p_kind, v_body,
          v_url, v_width, v_height, p_reply_to, coalesce(p_spoiler, false),
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.buddy_messages m where m.buddy_read_id = p_read)))
  returning * into v_row;
  return private.buddy_message_json(v_caller, v_row);
end;
$$;

-- A page of a thread (p_section null = the room), newest first: at most p_limit (1..100, default 50)
-- messages older than p_before and newer than p_after. Every message of the thread, whatever her
-- Section (the veil is the app's), but none of a member blocked with her either way (her own always).
-- Answers a JSON array of messages as private.buddy_message_json makes them.
create or replace function public.buddy_read_messages(
  p_read uuid,
  p_section uuid default null,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 50
)
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
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(private.buddy_message_json(v_caller, m) order by m.created_at desc, m.id desc)
      from (select *
              from public.buddy_messages x
             where x.buddy_read_id = p_read
               and x.section_id is not distinct from p_section
               and (p_before is null or x.created_at < p_before)
               and (p_after is null or x.created_at > p_after)
               and not private.buddy_hidden(v_caller, x.author_id)
             order by x.created_at desc, x.id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
  ), '[]'::jsonb);
end;
$$;

-- React to a message: one reaction per member. A new emoji replaces hers, the same one again or null
-- removes it. Not on a tombstone, not in an archived read, 60 calls a minute.
create or replace function public.react_to_buddy_message(p_message uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_msg    public.buddy_messages;
  v_old    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('❤️', '😂', '😮', '😢', '🔥', '📚') then
    raise exception 'message_emoji_invalid' using errcode = '22023';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller);
  if (select status from public.buddy_reads where id = v_msg.buddy_read_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message_unavailable' using errcode = 'PT409';
  end if;
  perform private.buddy_rate_window(v_caller, 'react', 60, interval '1 minute');

  select emoji into v_old from public.buddy_reactions where message_id = p_message and member_id = v_caller;
  if p_emoji is null or p_emoji = v_old then
    delete from public.buddy_reactions where message_id = p_message and member_id = v_caller;
  elsif v_old is null then
    insert into public.buddy_reactions (message_id, member_id, emoji) values (p_message, v_caller, p_emoji);
  else
    update public.buddy_reactions set emoji = p_emoji, created_at = clock_timestamp()
     where message_id = p_message and member_id = v_caller;
  end if;
end;
$$;

-- Delete a message: the author hers, the host any (also one by a member she blocked, or who blocked
-- her: she moderates her room). It stays as a tombstone (its place in the thread, the answers to it),
-- without its words, its GIF or its reactions. Also in an archived read. Again: nothing changes. No
-- rate limit: each call ends one message at most (the author's own, or, for the host, one of her
-- room's), and a tombstone stays one.
create or replace function public.delete_buddy_message(p_message uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller, p_as_host => true);
  if v_msg.author_id <> v_caller and (private.buddy_gate(v_msg.buddy_read_id, v_caller)).role <> 'host' then
    raise exception 'message_not_yours' using errcode = 'PT403';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;
  delete from public.buddy_reactions where message_id = p_message;
  update public.buddy_messages
     set body = '', media_url = null, media_width = null, media_height = null,
         deleted_at = clock_timestamp(), deleted_by = v_caller
   where id = p_message;
end;
$$;

-- She has read a thread (p_section null = the room) up to p_through (null: up to now). A cursor only
-- moves forward, and never past the read's newest message or the clock, whichever is later. No rate
-- limit: a call writes at most her own one cursor row and sends nothing, and a call that would not
-- move it (the screen marks as it scrolls) answers before the read's lock, so it never queues behind
-- or ahead of the read's writes.
create or replace function public.mark_buddy_read(p_read uuid, p_section uuid, p_through timestamptz)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_to     timestamptz;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;
  -- Nothing to move: answer before the lock.
  if p_through is not null and p_through <= (
       case when p_section is null
            then (select last_read_at from public.buddy_read_members where buddy_read_id = p_read and member_id = v_caller)
            else (select last_read_at from public.buddy_section_cursors where section_id = p_section and member_id = v_caller)
       end) then
    return;
  end if;
  perform private.buddy_lock_read(p_read);
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;

  v_to := greatest(clock_timestamp(), (select max(created_at) from public.buddy_messages where buddy_read_id = p_read));
  v_to := least(coalesce(p_through, v_to), v_to);

  if p_section is null then
    update public.buddy_read_members set last_read_at = greatest(last_read_at, v_to)
     where buddy_read_id = p_read and member_id = v_caller
       and (last_read_at is null or last_read_at < v_to);
  else
    insert into public.buddy_section_cursors as c (section_id, member_id, last_read_at)
    values (p_section, v_caller, v_to)
    on conflict (section_id, member_id)
      do update set last_read_at = greatest(c.last_read_at, excluded.last_read_at);
  end if;
end;
$$;

-- Report someone else's message to the instance owner: one feedback row as her, kind 'report', the
-- body her reason and note, the context {buddy_read, section, message, author, excerpt} with the
-- message's first 300 characters. Reasons: harassment, spam, inappropriate, other; a note of at most
-- 1000 characters. Not her own message, not a tombstone, members only. Once per reporter and message:
-- reporting the same message again changes nothing (her first report stands), so one message cannot
-- fill the owner's inbox. The feedback limiter (5 an hour, 20 a day) refuses the rest as rate_limited.
-- A report is her feedback row: it goes with her account (feedback cascades from auth.users), and it
-- stays when the author's account or the message goes (it holds ids and the excerpt).
create or replace function public.report_buddy_message(p_message uuid, p_reason text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r'), '');
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'report_reason_invalid' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'report_note_too_long' using errcode = '22023';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller);
  if v_msg.author_id = v_caller then
    raise exception 'report_self' using errcode = '22023';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message_unavailable' using errcode = 'PT409';
  end if;
  -- Reported before: her first report stands. Under the read's lock, so two at once make one row.
  if exists (select 1 from public.feedback f
              where f.member_id = v_caller and f.kind = 'report' and f.context ->> 'message' = v_msg.id::text) then
    return;
  end if;

  insert into public.feedback (member_id, kind, body, context)
  values (v_caller, 'report',
          'Buddy read report: ' || p_reason || coalesce(E'\n\n' || v_note, ''),
          jsonb_build_object(
            'buddy_read', v_msg.buddy_read_id,
            'section', v_msg.section_id,
            'message', v_msg.id,
            'author', v_msg.author_id,
            'excerpt', left(concat_ws(' ', nullif(v_msg.body, ''), v_msg.media_url), 300)));
end;
$$;

-- ------------------------------------------------------------- D1's functions, now with messages

-- As 20261113010000_buddy_reads.sql left it, and unread is real: her unread messages over the room and
-- the Sections she may open (private.buddy_unread). create or replace keeps its grants.
-- Her reads and her waiting invitations. A read: its Book, status, her role, how many joined, her
-- own Section (`where`), unread. Every active read of hers and the 20 that ended last;
-- active first, then by start, newest first. An invitation: the Book, the host, who invited her, how
-- many joined; one that a block with any member of the read would refuse is left out; the 50 newest.
create or replace function public.my_buddy_reads()
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

  return jsonb_build_object(
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'status', r.status,
               'starts_on', r.starts_on,
               'role', m.role,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id),
               'where', private.buddy_where(m, private.buddy_parts(r.id)),
               'unread', private.buddy_unread(r.id, v_caller)
             ) order by (r.status = 'active') desc, r.starts_on desc, r.created_at desc, r.id)
        from public.buddy_read_members m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
       where m.member_id = v_caller and m.joined_at is not null
         and (r.status = 'active'
              or r.id in (select e.id
                            from public.buddy_read_members em
                            join public.buddy_reads e on e.id = em.buddy_read_id
                           where em.member_id = v_caller and em.joined_at is not null and e.status <> 'active'
                           order by coalesce(e.archived_at, e.finished_at) desc nulls last, e.id
                           limit 20))
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'starts_on', r.starts_on,
               'host', (select private.member_card(v_caller, h.member_id) from public.buddy_read_members h
                         where h.buddy_read_id = r.id and h.role = 'host'),
               'invited_by', case when m.invited_by is not null then private.member_card(v_caller, m.invited_by) end,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id)
             ) order by m.invited_at desc, r.id)
        from (select m0.*
                from public.buddy_read_members m0
                join public.buddy_reads r0 on r0.id = m0.buddy_read_id
               where m0.member_id = v_caller and m0.joined_at is null and r0.status = 'active'
                 and not exists (select 1 from public.buddy_read_members x
                                  where x.buddy_read_id = r0.id and x.member_id <> v_caller
                                    and private.blocked_either(x.member_id, v_caller))
               order by m0.invited_at desc, r0.id
               limit 50) m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
    ), '[]'::jsonb)
  );
end;
$$;

-- As 20261113010000_buddy_reads.sql left it, and each Section's count and unread are real
-- (private.buddy_counts: no tombstones, no message of a member blocked with her), and the room's are
-- `room: {count, unread}`. Every Section's numbers, veiled or not: the app draws the veil (a veiled
-- row shows its count, no unread dot).
-- One read, for a joined member: the screen. Its Book, status, her role and whether she manages
-- it, the Sections, the joined members with their role and `where` (a Section, never a number), her
-- own place (`me`), and for the host the link and the waiting invitations.
create or replace function public.buddy_read(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
  v_read   public.buddy_reads;
  v_parts  integer;
  v_host   boolean;
  v_counts jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_me := private.buddy_gate(p_id, v_caller);
  select * into v_read from public.buddy_reads where id = p_id;
  v_parts := private.buddy_parts(p_id);
  v_host := v_me.role = 'host';
  select coalesce(jsonb_object_agg(coalesce(c.section_id::text, 'room'),
                                   jsonb_build_object('count', c.total, 'unread', c.unread)), '{}'::jsonb)
    into v_counts
    from private.buddy_counts(p_id, v_caller) c;

  return jsonb_build_object(
    'id', v_read.id,
    'book', (select private.social_book_json(b) from public.books b where b.id = v_read.book_id),
    'status', v_read.status,
    'starts_on', v_read.starts_on,
    'finished_at', v_read.finished_at,
    'archived_at', v_read.archived_at,
    'sections_from', v_read.sections_from,
    'page_count', v_read.page_count,
    'role', v_me.role,
    'can_manage', v_host,
    'room', coalesce(v_counts -> 'room', jsonb_build_object('count', 0, 'unread', 0)),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'position', s.position, 'kind', s.kind, 'label', s.label,
               'start_page', s.start_page, 'end_page', s.end_page, 'to_fraction', s.to_fraction,
               'count', coalesce((v_counts -> s.id::text ->> 'count')::integer, 0),
               'unread', coalesce((v_counts -> s.id::text ->> 'unread')::integer, 0)
             ) order by s.position)
        from public.buddy_read_sections s where s.buddy_read_id = p_id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(private.buddy_card(v_caller, m, v_parts)
                       order by (m.role = 'host') desc, m.joined_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is not null
    ), '[]'::jsonb),
    'me', private.buddy_me(v_me, v_parts),
    'link_token', case when v_host then v_read.link_token end,
    'invited', case when v_host then coalesce((
      select jsonb_agg(private.member_card(v_caller, m.member_id) order by m.invited_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is null
    ), '[]'::jsonb) end
  );
end;
$$;

-- As 20261113010000_buddy_reads.sql left it, and p_delete_messages deletes what she wrote in this
-- read: her messages (their reactions go with them, answers to them keep their text and lose the
-- link) and her reactions on the others' messages. Without it her messages and reactions stay, under
-- her name. The choice to delete is made when leaving; after that only account deletion removes them
-- (a member who left can no longer call anything of the read). Her Section cursors go either way
-- (private.buddy_cursors_gone).
-- She leaves: her member row goes, and with it her Section from every member's view at once. The host
-- role passes to the earliest-joined member; the last one out deletes the read (the trigger).
create or replace function public.leave_buddy_read(p_id uuid, p_delete_messages boolean default false)
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
  perform private.buddy_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if coalesce(p_delete_messages, false) then
    delete from public.buddy_reactions r
     using public.buddy_messages m
     where m.id = r.message_id and m.buddy_read_id = p_id and r.member_id = v_caller;
    delete from public.buddy_messages where buddy_read_id = p_id and author_id = v_caller;
  end if;
  delete from public.buddy_read_members where buddy_read_id = p_id and member_id = v_caller;
end;
$$;

-- As 20261113010000_buddy_reads.sql left it, and a replacement is refused as buddy_sections_locked
-- (PT409) once any Section thread of the read has a message, a tombstone included: replacing deletes
-- the Sections, and their messages with them. A rename is always allowed.
-- The host changes the Sections. The same division (as many Sections, each of the same kind and
-- ending at the same fraction) is a rename: labels and pages change, the Sections keep their ids.
-- Another division replaces them and every member's hand-set Section is held to the new number of parts.
-- Answers the read as buddy_read does.
create or replace function public.set_buddy_sections(
  p_id uuid,
  p_sections jsonb,
  p_from text default 'count',
  p_page_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_new    jsonb;
  v_same   boolean;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;

  select jsonb_agg(to_jsonb(s) order by s.s_position) into v_new
    from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count) s;

  with n as (
    select * from jsonb_to_recordset(v_new)
      as x(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
  )
  select (select count(*) from n) = (select count(*) from public.buddy_read_sections where buddy_read_id = p_id)
     and not exists (
       select 1 from n
         left join public.buddy_read_sections s
           on s.buddy_read_id = p_id and s.position = n.s_position and s.kind = n.s_kind and s.to_fraction = n.s_to_fraction
        where s.id is null)
    into v_same;

  if v_same then
    update public.buddy_read_sections s
       set label = n.s_label, start_page = n.s_start_page, end_page = n.s_end_page
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
     where s.buddy_read_id = p_id and s.position = n.s_position;
  else
    if exists (select 1 from public.buddy_messages where buddy_read_id = p_id and section_id is not null) then
      raise exception 'buddy_sections_locked' using errcode = 'PT409';
    end if;
    delete from public.buddy_read_sections where buddy_read_id = p_id;
    insert into public.buddy_read_sections (buddy_read_id, position, kind, label, start_page, end_page, to_fraction)
    select p_id, n.s_position, n.s_kind, n.s_label, n.s_start_page, n.s_end_page, n.s_to_fraction
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric);
    v_parts := private.buddy_parts(p_id);
    update public.buddy_read_members set hand_through = v_parts
     where buddy_read_id = p_id and hand_through > v_parts;
  end if;

  update public.buddy_reads set sections_from = coalesce(p_from, 'count'), page_count = p_page_count where id = p_id;
  return public.buddy_read(p_id);
end;
$$;

-- ------------------------------------------------------------------------- grants

-- The helpers are for the functions above only.
revoke all on function private.buddy_rate_window(uuid, text, integer, interval) from public, anon, authenticated;
revoke all on function private.buddy_hidden(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_reactions_json(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_message_json(uuid, public.buddy_messages) from public, anon, authenticated;
revoke all on function private.buddy_message_for(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.buddy_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_unread(uuid, uuid) from public, anon, authenticated;
revoke all on function private.buddy_cursors_gone() from public, anon, authenticated;

revoke all on function public.post_buddy_message(uuid, uuid, uuid, text, text, uuid, boolean, jsonb) from public, anon;
revoke all on function public.buddy_read_messages(uuid, uuid, timestamptz, timestamptz, integer) from public, anon;
revoke all on function public.react_to_buddy_message(uuid, text) from public, anon;
revoke all on function public.delete_buddy_message(uuid) from public, anon;
revoke all on function public.mark_buddy_read(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.report_buddy_message(uuid, text, text) from public, anon;
grant execute on function public.post_buddy_message(uuid, uuid, uuid, text, text, uuid, boolean, jsonb) to authenticated;
grant execute on function public.buddy_read_messages(uuid, uuid, timestamptz, timestamptz, integer) to authenticated;
grant execute on function public.react_to_buddy_message(uuid, text) to authenticated;
grant execute on function public.delete_buddy_message(uuid) to authenticated;
grant execute on function public.mark_buddy_read(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.report_buddy_message(uuid, text, text) to authenticated;
