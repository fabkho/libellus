-- The reader's highlights, kept server-side (issue #131, phase 2 follow-up).
--
-- Until now a highlight lived on the device that made it. This table keeps it
-- for the member's Library entry, so a second device that holds the same
-- EPUB shows it too, and a new phone does not start without them. Her own
-- reading, so the words are kept as well, capped: the excerpt is what she
-- selected (at most 1000 characters), the note is room for her own words
-- (empty for now). Nothing of the book beyond that, and no file, ever leaves
-- the device.
--
-- A highlight belongs to the entry, not to a file. What places it is its CFI,
-- and a CFI only means something in the file it was taken in, so every row
-- carries `file_hash`, the fingerprint of that copy (SHA-256 of its first
-- megabyte, phase 1's `hash`; the same value `reader_places` keeps). A device
-- whose copy has the same fingerprint draws the highlight on the page; one
-- whose copy differs (another edition, after Change edition or a different
-- file) keeps the row and lists it as "Highlights from another copy" in the
-- Contents sheet, unplaced. Nothing is dropped when the file changes.
--
-- Two devices change highlights independently, so a row is merged by the
-- moment the change was made on the device (`updated_at`, last write wins per
-- highlight id) and a deletion is a tombstone (`deleted_at`) that wins over
-- an older edit instead of a missing row that would let it come back. A
-- tombstone holds no words: the excerpt and the note are emptied (a check
-- keeps a direct write honest too). A write older than the stored row is
-- ignored.
--
-- Writes go through `save_reader_highlight`, one row per call, and the device
-- sends them through `sync_write` (action `save_reader_highlight`) so they
-- wait in the outbox offline and are applied at most once. Reading is a plain
-- select through RLS. There is no delete grant: a highlight goes with its
-- entry (`on delete cascade`) and with the member (auth.users cascades), so
-- `delete_my_account` takes every highlight of hers with it.
--
-- `sync_write` runs as its owner, so the function does not lean on RLS: it
-- checks the member and the entry itself, and an id that belongs to another
-- member is never touched.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in      42501  no member behind the call
--   entry_not_found    P0002  no such entry in this member's Library
--   highlight_invalid  22023  an empty or over-long CFI, an unknown colour, a
--                             negative section, a fingerprint that is not 64
--                             hex characters, a note over 2000 characters, an
--                             id that is not hers

create table public.reader_highlights (
  id            uuid primary key,
  member_id     uuid not null default auth.uid() references auth.users on delete cascade,
  entry_id      uuid not null references public.library_entries (id) on delete cascade,
  file_hash     text not null,
  cfi           text not null,
  section_index integer not null,
  color         text not null,
  excerpt       text not null default '',
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint reader_highlights_file_hash_sha256 check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint reader_highlights_cfi_present check (char_length(cfi) between 1 and 2000),
  constraint reader_highlights_section_index check (section_index >= 0),
  constraint reader_highlights_color check (color in ('lamp', 'sage', 'sky', 'rose')),
  constraint reader_highlights_excerpt_cap check (char_length(excerpt) <= 1000),
  constraint reader_highlights_note_cap check (note is null or char_length(note) <= 2000),
  constraint reader_highlights_tombstone_empty check (deleted_at is null or (excerpt = '' and note is null))
);

comment on table public.reader_highlights is
  'Issue #131: the member''s highlights in a Library entry''s ebook — where (CFI and section), the '
  'colour, her selected words (capped) and the fingerprint of the file they were made in. Hers alone. '
  'Merged by updated_at (last write wins per id); a deleted highlight stays as a tombstone with no words.';
comment on column public.reader_highlights.id is
  'Made on the device (a v4 UUID), so a highlight can be written offline and sent later, once.';
comment on column public.reader_highlights.member_id is
  'The member the highlight belongs to; always the member of its entry. Goes with her account.';
comment on column public.reader_highlights.entry_id is
  'The Library entry the highlight is in. It survives a change of edition; file_hash says which copy places it.';
comment on column public.reader_highlights.file_hash is
  'SHA-256 (64 lower-case hex) of the first megabyte of the file the CFI was taken in. A device with the '
  'same fingerprint draws it on the page; another copy lists it unplaced.';
comment on column public.reader_highlights.cfi is
  'The EPUB CFI range of the words (at most 2000 characters). Only the same file can follow it exactly.';
comment on column public.reader_highlights.section_index is
  'The book''s section (spine item) the range is in; the reader draws a section''s highlights when it loads.';
comment on column public.reader_highlights.color is
  'One of the four highlight tokens: lamp, sage, sky, rose.';
comment on column public.reader_highlights.excerpt is
  'The words she selected, cut at 1000 characters. Empty on a tombstone.';
comment on column public.reader_highlights.note is
  'Her own words on the highlight; none yet. Empty on a tombstone.';
comment on column public.reader_highlights.updated_at is
  'When the change was made on the device that made it. A write older than this one is ignored.';
comment on column public.reader_highlights.deleted_at is
  'When the highlight was removed (the tombstone), else null.';

-- The foreign keys, indexed: the entry's (also how one book's highlights are
-- read) and the member's, for the cascade.
create index reader_highlights_entry on public.reader_highlights (entry_id);
create index reader_highlights_member on public.reader_highlights (member_id);

-- --------------------------------------------------------------- forward only

create schema if not exists private;

-- A highlight never travels backwards: an update that is not newer than the row
-- it would replace is dropped, whoever writes it. And what names the highlight
-- (its member, its entry, when it was first made) is never changed by an update.
create function private.reader_highlights_forward_only()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  new.member_id  := old.member_id;
  new.entry_id   := old.entry_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

revoke all on function private.reader_highlights_forward_only() from public, anon, authenticated;

create trigger reader_highlights_forward_only
  before update on public.reader_highlights
  for each row execute function private.reader_highlights_forward_only();

-- ------------------------------------------------------------------------ RLS

alter table public.reader_highlights enable row level security;

-- A member reads and writes her own highlights, on entries of hers. Nobody
-- deletes one by hand (a removal is a tombstone; the rest goes with the entry).
revoke all on public.reader_highlights from anon, authenticated;
grant select, insert, update on public.reader_highlights to authenticated;

create policy reader_highlights_select_own on public.reader_highlights
  for select to authenticated
  using (member_id = (select auth.uid()));

create policy reader_highlights_insert_own on public.reader_highlights
  for insert to authenticated
  with check (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.library_entries e
       where e.id = entry_id and e.member_id = (select auth.uid())
    )
  );

create policy reader_highlights_update_own on public.reader_highlights
  for update to authenticated
  using (member_id = (select auth.uid()))
  with check (
    member_id = (select auth.uid())
    and exists (
      select 1 from public.library_entries e
       where e.id = entry_id and e.member_id = (select auth.uid())
    )
  );

-- ------------------------------------------------------- save_reader_highlight

-- Saves one highlight (or its removal, `p_deleted`) and returns the row that
-- stands afterwards: the one sent, or the newer one that was there already.
-- `p_at` is when the change was made on the device; a clock that runs more than
-- a minute ahead is brought back to now, so no device can park a change in the
-- future and silence the others. `p_created_at` is when the highlight was first
-- made (kept from the first write; never after `p_at`). The excerpt is cut at
-- 1000 characters rather than refused: the words are a courtesy, the place is
-- the highlight.
--
-- Security invoker, so RLS is the rule for a direct call; `sync_write` runs it
-- as its owner, which is why the member, the entry and the id are checked here
-- too.
create function public.save_reader_highlight(
  p_id            uuid,
  p_entry_id      uuid,
  p_file_hash     text,
  p_cfi           text,
  p_section_index integer,
  p_color         text,
  p_excerpt       text default '',
  p_note          text default null,
  p_deleted       boolean default false,
  p_at            timestamptz default now(),
  p_created_at    timestamptz default null
)
returns public.reader_highlights
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_at      timestamptz;
  v_created timestamptz;
  v_deleted boolean := coalesce(p_deleted, false);
  v_row     public.reader_highlights;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.library_entries e where e.id = p_entry_id and e.member_id = v_member
  ) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_id is null
     or p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$'
     or p_cfi is null or char_length(p_cfi) not between 1 and 2000
     or p_section_index is null or p_section_index < 0
     or p_color is null or p_color not in ('lamp', 'sage', 'sky', 'rose')
     or char_length(p_note) > 2000 then
    raise exception 'highlight_invalid' using errcode = '22023';
  end if;

  v_at := coalesce(p_at, now());
  if v_at > now() + interval '1 minute' then
    v_at := now();
  end if;
  v_created := least(coalesce(p_created_at, v_at), v_at);

  insert into public.reader_highlights as h
    (id, member_id, entry_id, file_hash, cfi, section_index, color, excerpt, note,
     created_at, updated_at, deleted_at)
  values
    (p_id, v_member, p_entry_id, p_file_hash, p_cfi, p_section_index, p_color,
     case when v_deleted then '' else left(coalesce(p_excerpt, ''), 1000) end,
     case when v_deleted then null else nullif(p_note, '') end,
     v_created, v_at,
     case when v_deleted then v_at end)
  on conflict (id) do update
    set file_hash     = excluded.file_hash,
        cfi           = excluded.cfi,
        section_index = excluded.section_index,
        color         = excluded.color,
        excerpt       = excluded.excerpt,
        note          = excluded.note,
        updated_at    = excluded.updated_at,
        deleted_at    = excluded.deleted_at
    where h.member_id = v_member
      and h.entry_id = excluded.entry_id
      and excluded.updated_at > h.updated_at
  returning h.* into v_row;

  -- Nothing was written: a newer change is stored already, and that one stands.
  if v_row.id is null then
    select * into v_row from public.reader_highlights
     where id = p_id and member_id = v_member and entry_id = p_entry_id;
    if not found then
      -- The id is in use for something that is not hers or not on this entry.
      raise exception 'highlight_invalid' using errcode = '22023';
    end if;
  end if;
  return v_row;
end;
$$;

comment on function public.save_reader_highlight(uuid, uuid, text, text, integer, text, text, text, boolean, timestamptz, timestamptz) is
  'Issue #131: saves one of the member''s highlights, or its removal (a tombstone with no words), and '
  'returns the row that stands. Last write wins per id: a change older than the stored one is ignored.';

revoke all on function public.save_reader_highlight(uuid, uuid, text, text, integer, text, text, text, boolean, timestamptz, timestamptz) from public, anon;
grant execute on function public.save_reader_highlight(uuid, uuid, text, text, integer, text, text, text, boolean, timestamptz, timestamptz) to authenticated;

-- ----------------------------------------------------------------- sync_write

-- #93's sync_write, taking `save_reader_highlight` as one more write a device
-- may queue; nothing else changed.
create or replace function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_today   date := (now() at time zone 'utc')::date;
  v_args    jsonb := coalesce(p_args, '{}'::jsonb);
  v_result  jsonb := '{}'::jsonb;
  v_entry   public.library_entries;
  v_session public.reading_sessions;
  v_day     date;
  v_mine    uuid;
  v_first   uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid' using errcode = '22023';
  end if;

  -- Claimed first: a second send of the same write waits here until the first
  -- commits (and then answers from it) or rolls back (and then applies it).
  insert into public.synced_writes (request_id, member_id, action)
  values (p_request_id, v_member, p_action)
  on conflict (request_id) do nothing;
  if not found then
    select member_id, result into v_mine, v_result from public.synced_writes where request_id = p_request_id;
    if v_mine is distinct from v_member then
      raise exception 'request_invalid' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true) || v_result;
  end if;

  case p_action
    when 'add_to_library' then
      select * into v_entry from public.add_to_library(
        p_book       => v_args -> 'p_book',
        p_status     => coalesce((v_args ->> 'p_status')::public.entry_status, 'want_to_read'),
        p_started_on => (v_args ->> 'p_started_on')::date,
        p_ended_on   => (v_args ->> 'p_ended_on')::date,
        p_rating     => (v_args ->> 'p_rating')::integer,
        p_review     => v_args ->> 'p_review'
      );
      select s.id into v_first from public.latest_session(v_entry) s;
      v_result := jsonb_strip_nulls(jsonb_build_object('entry_id', v_entry.id, 'session_id', v_first));

    when 'start_reading' then
      select * into v_session from public.start_reading(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'read_again' then
      select * into v_session from public.read_again(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'finish_reading' then
      perform public.finish_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_rating   => (v_args ->> 'p_rating')::integer,
        p_review   => v_args ->> 'p_review'
      );

    when 'abandon_reading' then
      perform public.abandon_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_reason   => v_args ->> 'p_reason'
      );

    when 'update_progress' then
      -- The member's day, moved into the window when the write waited longer (see above).
      v_day := (v_args ->> 'p_day')::date;
      if v_day < v_today - 1 then
        v_day := v_today - 1;
      end if;
      perform public.update_progress(
        p_entry_id       => (v_args ->> 'p_entry_id')::uuid,
        p_page           => (v_args ->> 'p_page')::integer,
        p_percent        => (v_args ->> 'p_percent')::integer,
        p_set_page_count => coalesce((v_args ->> 'p_set_page_count')::boolean, false),
        p_page_count     => (v_args ->> 'p_page_count')::integer,
        p_day            => v_day,
        p_clear          => coalesce((v_args ->> 'p_clear')::boolean, false)
      );

    when 'update_session' then
      perform public.update_session(
        p_session_id     => (v_args ->> 'p_session_id')::uuid,
        p_started_on     => (v_args ->> 'p_started_on')::date,
        p_ended_on       => (v_args ->> 'p_ended_on')::date,
        p_rating         => (v_args ->> 'p_rating')::integer,
        p_review         => v_args ->> 'p_review',
        p_abandon_reason => v_args ->> 'p_abandon_reason'
      );

    when 'remove_from_library' then
      perform public.remove_from_library(p_entry_id => (v_args ->> 'p_entry_id')::uuid);

    when 'add_to_collection' then
      select * into v_entry from public.add_to_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_book       => v_args -> 'p_book'
      );
      v_result := jsonb_build_object('entry_id', v_entry.id);

    when 'remove_from_collection' then
      perform public.remove_from_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entry      => (v_args ->> 'p_entry')::uuid
      );

    when 'reorder_collection' then
      perform public.reorder_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entries    => array(select jsonb_array_elements_text(v_args -> 'p_entries')::uuid)
      );

    when 'rename_collection' then
      perform public.rename_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_name       => v_args ->> 'p_name'
      );

    when 'delete_collection' then
      perform public.delete_collection(p_collection => (v_args ->> 'p_collection')::uuid);

    when 'save_reader_highlight' then
      perform public.save_reader_highlight(
        p_id            => (v_args ->> 'p_id')::uuid,
        p_entry_id      => (v_args ->> 'p_entry_id')::uuid,
        p_file_hash     => v_args ->> 'p_file_hash',
        p_cfi           => v_args ->> 'p_cfi',
        p_section_index => (v_args ->> 'p_section_index')::integer,
        p_color         => v_args ->> 'p_color',
        p_excerpt       => v_args ->> 'p_excerpt',
        p_note          => v_args ->> 'p_note',
        p_deleted       => coalesce((v_args ->> 'p_deleted')::boolean, false),
        p_at            => (v_args ->> 'p_at')::timestamptz,
        p_created_at    => (v_args ->> 'p_created_at')::timestamptz
      );

    else
      raise exception 'action_invalid' using errcode = '22023';
  end case;

  update public.synced_writes set result = v_result where request_id = p_request_id;
  -- Housekeeping: her own old rows, a handful at most.
  delete from public.synced_writes where member_id = v_member and synced_at < now() - interval '60 days';
  return jsonb_build_object('replayed', false) || v_result;
end;
$$;

comment on function public.sync_write(uuid, text, jsonb) is
  'Applies a write the device queued offline (issue #93) through the same function the online '
  'call uses, at most once per p_request_id: a second send answers with the first result. '
  'Also takes the reader''s highlights (save_reader_highlight, issue #131).';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;