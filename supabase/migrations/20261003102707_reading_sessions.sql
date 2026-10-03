-- Reading sessions and the Status they decide (issue #1, Data model; issue #7).
--
-- A Reading session is one read of a Library entry: when it started, when it
-- ended, how it ended (finished or abandoned; nothing while it is still open),
-- the Rating in quarter stars, a review, and why it was abandoned. Re-reads and
-- abandoned attempts are more sessions on the same entry, never new entries.
--
-- The entry's Status follows from its sessions and nothing else:
--   no session                 → want_to_read
--   the latest session is open → reading      (an open session is always the latest)
--   the latest session closed  → finished     (finished or abandoned; the *Not
--                                              finished* filter reads the outcome)
-- `library_entries.status` stays a column, so lists filter and sort on it with
-- an index, but it is the database's to keep: a trigger recomputes it whenever
-- a session changes and overwrites anything else written into it. Clients
-- never write it (members cannot write either table; see the RPCs below).
--
-- Members change sessions only through one function per Library action, so a
-- native client calls the same functions and gets the same refusals:
--   start_reading   (#7)  Want to read → Currently reading
--   finish_reading  (#7)  Currently reading → Finished, with date, Rating, review
--   abandon_reading (#10) Currently reading → Finished (abandoned), with date, reason
--   read_again      (#10) Finished → Currently reading, as a new session
--   update_session, delete_session (#11)
-- (`finish_reading`, not `finish`: pgTAP owns a `finish()` and every test calls it.)
--
-- Refusals are `raise` messages with stable SQLSTATEs, as in add_to_library:
--   not_signed_in          42501  no member behind the call
--   entry_not_found        P0002  no such entry in this member's Library (another
--                                 member's entry is "not found" too, never "forbidden")
--   already_reading        23505  the entry has an open session
--   already_finished       22023  the entry was read before: Read again (#10) starts the next read
--   not_reading            22023  there is no open session to end
--   date_invalid           22023  a date the action needs is missing
--   date_in_future         22023  a date later than today, wherever on Earth today is latest
--   ended_before_started   22023  an end date before the session's start date
--   rating_invalid         22023  a Rating outside 1–20 quarters
--   review_too_long        22023  a review over 10,000 characters

create type public.session_outcome as enum ('finished', 'abandoned');

-- ----------------------------------------------------------- reading sessions

create table public.reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.library_entries on delete cascade,
  -- Days, not instants: the member's calendar day, as they picked it. Both may
  -- be missing on a finished read logged after the fact (an import, "read it
  -- years ago"); an open session always has its start.
  started_on      date,
  ended_on        date,
  -- Null while the session is open.
  outcome         public.session_outcome,
  -- Quarter stars: 1 = 0.25 … 20 = 5.00. Null is unrated, not zero.
  rating          smallint,
  review          text,
  abandon_reason  text,
  created_at      timestamptz not null default now(),

  constraint reading_sessions_open_has_start check (outcome is not null or started_on is not null),
  constraint reading_sessions_open_has_no_end check (outcome is not null or ended_on is null),
  constraint reading_sessions_end_after_start check (ended_on >= started_on),
  constraint reading_sessions_rating_quarters check (rating between 1 and 20),
  -- `is not distinct from`: an open session's outcome is null, and a plain `=`
  -- would let the check pass on null.
  constraint reading_sessions_rating_when_finished check (rating is null or outcome is not distinct from 'finished'),
  constraint reading_sessions_review_when_closed check (review is null or outcome is not null),
  -- Text with something in it (blank is stored as null), and not a novel.
  constraint reading_sessions_review_present check (review ~ '\S' and char_length(review) <= 10000),
  constraint reading_sessions_reason_when_abandoned check (abandon_reason is null or outcome is not distinct from 'abandoned'),
  constraint reading_sessions_reason_present check (abandon_reason ~ '\S' and char_length(abandon_reason) <= 1000)
);

comment on table public.reading_sessions is
  'One read of a Library entry. Private to the entry''s member. Written only through the Library '
  'actions (start_reading, finish_reading; abandon and read again in #10, edits in #11) or the '
  'owner''s import; the entry''s status follows from these rows.';
comment on column public.reading_sessions.rating is
  'Integer quarter stars, 1–20 (3.75 stars = 15). Null = unrated. Only on finished sessions.';

-- At most one open session per entry: a new read starts only once the last one ended.
create unique index reading_sessions_one_open on public.reading_sessions (entry_id) where outcome is null;
create index reading_sessions_entry on public.reading_sessions (entry_id, ended_on desc);

-- No dates in the future. The database cannot know the member's time zone, so
-- "today" is the latest today anywhere (UTC+14): a date after that is in the
-- future for everyone. Clients hold the member to their own today. A trigger,
-- not a check, because the answer depends on when the row is written.
create function public.reading_sessions_no_future_dates()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  -- POSIX zone names count backwards: Etc/GMT-14 is UTC+14.
  v_latest_today date := (now() at time zone 'Etc/GMT-14')::date;
begin
  if new.started_on > v_latest_today or new.ended_on > v_latest_today then
    raise exception 'date_in_future' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger reading_sessions_no_future_dates
  before insert or update of started_on, ended_on on public.reading_sessions
  for each row execute function public.reading_sessions_no_future_dates();

-- -------------------------------------------------------- the derived status

-- An entry's Status from its sessions (see the top of this file).
create function public.entry_status_of(p_entry_id uuid)
returns public.entry_status
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when exists (select 1 from public.reading_sessions where entry_id = p_entry_id and outcome is null)
      then 'reading'
    when exists (select 1 from public.reading_sessions where entry_id = p_entry_id)
      then 'finished'
    else 'want_to_read'
  end::public.entry_status
$$;

revoke all on function public.entry_status_of(uuid) from public, anon, authenticated;

-- Whatever is written into `status` (add_to_library's default, an import, a
-- hand-made update) is replaced by what the sessions say.
create function public.library_entries_derive_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.status := public.entry_status_of(new.id);
  return new;
end;
$$;

create trigger library_entries_derive_status
  before insert or update on public.library_entries
  for each row execute function public.library_entries_derive_status();

-- A session started, ended, edited or deleted: its entry's Status follows.
create function public.reading_sessions_update_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op <> 'DELETE' then
    update public.library_entries set status = public.entry_status_of(id) where id = new.entry_id;
  end if;
  -- A session moved to another entry (or deleted) leaves its old entry behind.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.entry_id <> new.entry_id) then
    update public.library_entries set status = public.entry_status_of(id) where id = old.entry_id;
  end if;
  return null;
end;
$$;

create trigger reading_sessions_update_status
  after insert or update or delete on public.reading_sessions
  for each row execute function public.reading_sessions_update_status();

-- Entries made before sessions existed have none: Want to read, as they were.
update public.library_entries set status = public.entry_status_of(id);

comment on column public.library_entries.status is
  'Derived from the entry''s reading sessions (none → want_to_read, latest open → reading, '
  'latest closed → finished) by triggers; whatever else is written here is overwritten.';
comment on table public.library_entries is
  'One Book in one member''s Library. Private to its member. Created by add_to_library; the '
  'status follows from the reading sessions and is never written by a client.';

-- ------------------------------------------------------- the latest session

-- The session that decides the entry's Status and that lists show (dates,
-- Rating): the open one if there is one, otherwise the one that ended last.
-- Exposed to PostgREST as a to-one computed relationship
-- (`library_entries?select=*,latest:latest_session(*)`), so a list asks for its
-- entries and their latest sessions in one request and can sort on them.
create function public.latest_session(public.library_entries)
returns setof public.reading_sessions
language sql
stable
rows 1
set search_path = pg_catalog, public
as $$
  select s.*
    from public.reading_sessions s
   where s.entry_id = $1.id
   order by s.outcome is null desc, s.ended_on desc nulls last, s.started_on desc nulls last,
            s.created_at desc
   limit 1
$$;

-- ------------------------------------------------------------------------ RLS

alter table public.reading_sessions enable row level security;

revoke all on public.reading_sessions from anon, authenticated;
grant select on public.reading_sessions to authenticated;

create policy reading_sessions_own on public.reading_sessions
  for select to authenticated
  using (exists (
    select 1 from public.library_entries e
     where e.id = entry_id and e.member_id = (select auth.uid())
  ));

revoke all on function public.latest_session(public.library_entries) from public, anon;
grant execute on function public.latest_session(public.library_entries) to authenticated;

-- -------------------------------------------------------------- start_reading

-- Starts the first read of a Want to read entry on `p_started_on` (the
-- member's today, by default, in the client). Returns the open session; the
-- entry is Currently reading from now on. A Finished entry is read again with
-- read_again (#10), which keeps the earlier sessions.
create function public.start_reading(p_entry_id uuid, p_started_on date)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locked, so two taps from two devices cannot both start a read.
  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.status = 'reading' then
    raise exception 'already_reading' using errcode = '23505';
  end if;
  if v_entry.status = 'finished' then
    raise exception 'already_finished' using errcode = '22023';
  end if;
  if p_started_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;

  insert into public.reading_sessions (entry_id, started_on)
  values (v_entry.id, p_started_on)
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.start_reading(uuid, date) from public, anon;
grant execute on function public.start_reading(uuid, date) to authenticated;

-- ------------------------------------------------------------- finish_reading

-- Ends the open read of an entry as finished on `p_ended_on`, with an optional
-- Rating (quarters, 1–20) and an optional review (trimmed; blank is none).
-- Returns the closed session; the entry is Finished from now on.
create function public.finish_reading(
  p_entry_id uuid,
  p_ended_on date,
  p_rating   integer default null,
  p_review   text default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review  text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform 1 from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  select * into v_session from public.reading_sessions
   where entry_id = p_entry_id and outcome is null;
  if not found then
    raise exception 'not_reading' using errcode = '22023';
  end if;
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_ended_on < v_session.started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;

  update public.reading_sessions
     set ended_on = p_ended_on,
         outcome  = 'finished',
         rating   = p_rating,
         review   = v_review
   where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.finish_reading(uuid, date, integer, text) from public, anon;
grant execute on function public.finish_reading(uuid, date, integer, text) to authenticated;
