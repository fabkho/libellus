-- Progress by day (issue #68, phase 2 of design round #65's direction D).
--
-- Until now only the latest progress of a read was kept (#39). The reading
-- chart, the pace ("18 a day · 22 days"), "Last time · Yesterday · 24 pages"
-- and the reading log need to know how far each day went, so every progress
-- update now also writes the day it belongs to:
--
--   reading_progress_days   one row per read (session) and day
--     session_id            the read
--     day                   the member's own calendar day (see below)
--     start_page / start_percent
--                           where the read was before the day's first update
--                           (both null: it had no progress yet, i.e. 0)
--     end_page / end_percent
--                           where it was after the day's last update (exactly one)
--
-- How far a day went is end − start, both in the read's unit (pages against the
-- page count that counts, else percent; the client converts a value of the other
-- kind through the page count, `data/progressDays.ts`). The values are kept as
-- stored, so a later change of the page count does not rewrite history.
--
-- The day is the member's, not the server's: the app sends its local calendar
-- day (`p_day`, `isoDay()`), as it does for every other date. The database takes
-- any day within one of the server's UTC date (every time zone is), refuses
-- another as `date_invalid`, and falls back to the UTC date when none is sent
-- (callers from before this migration). A day before the read's last recorded
-- day (a phone that crossed time zones westwards) is booked on that last day, so
-- the days of a read only move forward.
--
-- Written only by `update_progress`, in the same call as the progress, so the two
-- cannot disagree:
--   * a new value on a day without a row: a row from the value before to the new one;
--   * the read's first value, set more than a day after it started, is where the
--     read already was (a read begun before #68, or recorded late), not a day's
--     reading: it books no day, and the days count on from it;
--   * a new value on a day with a row: its end moves, its start stays;
--   * a day that ends where it started (an Undo, a correction back) has no row;
--   * the total alone (no value) writes no day. A lower total that cuts the page
--     back (`clamp_session_progress`) leaves the days as they were; the client
--     never shows more than the page count.
-- Rows go with their read (`on delete cascade`): deleting a read or removing the
-- entry deletes its days; Finish and DNF keep them. History starts with this
-- migration: nothing is backfilled.
--
-- Members read their own days (RLS through the read's entry) and write none
-- directly.

create table public.reading_progress_days (
  session_id    uuid not null references public.reading_sessions (id) on delete cascade,
  day           date not null,
  start_page    integer,
  start_percent smallint,
  end_page      integer,
  end_percent   smallint,
  updated_at    timestamptz not null default now(),
  primary key (session_id, day),
  constraint reading_progress_days_start_one_kind check (num_nonnulls(start_page, start_percent) <= 1),
  constraint reading_progress_days_end_one_kind check (num_nonnulls(end_page, end_percent) = 1),
  constraint reading_progress_days_pages_not_negative check (start_page >= 0 and end_page >= 0),
  constraint reading_progress_days_percent_range
    check (start_percent between 0 and 100 and end_percent between 0 and 100)
);

comment on table public.reading_progress_days is
  'How far each day of a read went (issue #68): where it was before the day''s first progress '
  'update and after its last, on the member''s own calendar day. Written only by update_progress.';

alter table public.reading_progress_days enable row level security;

revoke all on public.reading_progress_days from anon, authenticated;
grant select on public.reading_progress_days to authenticated;

create policy reading_progress_days_own on public.reading_progress_days
  for select to authenticated
  using (exists (
    select 1 from public.reading_sessions s
      join public.library_entries e on e.id = s.entry_id
     where s.id = session_id and e.member_id = (select auth.uid())
  ));

-- ------------------------------------------------------------ update_progress

-- #60's update_progress (same arguments, same rules) with the member's day added;
-- a new signature, so the old one goes. Calls without `p_day` still work.
drop function public.update_progress(uuid, integer, integer, boolean, integer);

create function public.update_progress(
  p_entry_id       uuid,
  p_page           integer default null,
  p_percent        integer default null,
  p_set_page_count boolean default false,
  p_page_count     integer default null,
  p_day            date default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_today      date := (now() at time zone 'utc')::date;
  v_day        date;
  v_override   integer;
  v_book_count integer;
  v_page_count integer;
  v_session    public.reading_sessions;
  v_before     public.reading_sessions;
  v_row        public.reading_progress_days;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- The member's day: hers when it is one some time zone has now.
  v_day := coalesce(p_day, v_today);
  if v_day not between v_today - 1 and v_today + 1 then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  -- Locked, so progress from two devices lands one after the other.
  select e.page_count_override, b.page_count into v_override, v_book_count
    from public.library_entries e
    join public.books b on b.id = e.book_id
   where e.id = p_entry_id and e.member_id = v_member
     for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  select * into v_session from public.reading_sessions
   where entry_id = p_entry_id and outcome is null
     for update;
  if not found then
    raise exception 'not_reading' using errcode = '22023';
  end if;
  v_before := v_session;

  if p_set_page_count then
    if p_page_count is not null and p_page_count not between 1 and 99999 then
      raise exception 'progress_invalid' using errcode = '22023';
    end if;
    -- A total that only repeats the edition's is no override.
    v_override := case when p_page_count is not distinct from v_book_count then null else p_page_count end;
  end if;
  v_page_count := coalesce(v_override, v_book_count);

  if num_nonnulls(p_page, p_percent) > 1
     or (num_nonnulls(p_page, p_percent) = 0 and not p_set_page_count)
     or (p_page is not null and not public.progress_page_fits(p_page, v_page_count))
     or p_percent not between 0 and 100 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  if p_set_page_count then
    update public.library_entries set page_count_override = v_override where id = p_entry_id;
    perform public.clamp_session_progress(p_entry_id, v_page_count);
  end if;

  if num_nonnulls(p_page, p_percent) = 1 then
    update public.reading_sessions
       set progress_page       = p_page,
           progress_percent    = p_percent,
           progress_updated_at = now()
     where id = v_session.id
    returning * into v_session;

    -- The day: never before the read's last recorded one.
    select greatest(v_day, max(day)) into v_day
      from public.reading_progress_days where session_id = v_session.id;
    -- A first value well after the start is where the read already was: no day.
    if num_nonnulls(v_before.progress_page, v_before.progress_percent) = 0
       and (v_session.started_on is null or v_day > v_session.started_on + 1) then
      return v_session;
    end if;
    insert into public.reading_progress_days as d
           (session_id, day, start_page, start_percent, end_page, end_percent)
    values (v_session.id, v_day, v_before.progress_page, v_before.progress_percent, p_page, p_percent)
    on conflict (session_id, day) do update
       set end_page = excluded.end_page,
           end_percent = excluded.end_percent,
           updated_at = now()
    returning * into v_row;
    -- A day that ends where it started (none counts as page or percent 0) read nothing.
    if coalesce(v_row.start_page, case when v_row.start_percent is null and v_row.end_page is not null then 0 end)
         is not distinct from v_row.end_page
       and coalesce(v_row.start_percent, case when v_row.start_page is null and v_row.end_percent is not null then 0 end)
         is not distinct from v_row.end_percent then
      delete from public.reading_progress_days where session_id = v_row.session_id and day = v_row.day;
    end if;
  else
    select * into v_session from public.reading_sessions where id = v_session.id;
  end if;
  return v_session;
end;
$$;

revoke all on function public.update_progress(uuid, integer, integer, boolean, integer, date) from public, anon;
grant execute on function public.update_progress(uuid, integer, integer, boolean, integer, date) to authenticated;
