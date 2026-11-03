-- Progress on an earlier day (docs/plans/backdated-progress.md, PR 1: the database).
--
-- A member records where she ended a day she forgot to update (two days ago, a week ago), changes
-- a day of the reading log, adds one, removes one. Until now reading_progress_days was written
-- only by update_progress, for UTC today +/- 1 and never before the read's last recorded day.
--
--   public.set_progress_day(entry, day, page | percent)   where she ended that day (R1, R2)
--   public.delete_progress_day(entry, day)                 the day goes, the next one absorbs it (R6)
--   private.progress_value_in(page, percent, unit, count)  a value in a unit (the client's valueIn)
--   private.progress_day_write(read, count, day, ...)      the shared body of both
--   sync_write                                             the two as queued writes (offline)
--
-- The rules (the plan's section 4, R1-R12; the plan has the reasons). Notation: the read's days are
-- rows (day, start, end); prev(d) / next(d) the rows just before / after d; P the read's value
-- (reading_sessions.progress_*); E_L the latest row's end (none without rows). Every comparison is
-- in ONE unit, the kind of the value given (for a remove, the kind of the day's end), the other kind
-- converted through the page count that counts the way the client converts (round half up); none
-- is 0; a value that cannot be converted (a page without any page count) bounds nothing.
--
--   R2  One row per day. Setting a day that has a row moves its end and keeps its start; a day
--       without a row gets one whose start is end(prev), else the first row's start (the base),
--       else none. The day of a row is not an input.
--   R3  The value is CLAMPED (never refused) into [lo, hi]: lo = the day's start; hi = end(next),
--       else (the day is the latest) the page count / 100 % when the days lead P, else P. A row's
--       own end always stays inside its range (the range widens to it), so a row that already
--       went back (a re-read booked "-n" by the Today sheet) is not wiped by setting it again;
--       where lo > hi (a gap whose next day went back) lo wins and a new day gets no row.
--       A value that lands on hi (equal in the unit) takes hi's STORED value: end(next) as stored
--       (page and percent as they are), or P as stored when P bounded it. So a percent clamped to
--       a page day's end ends on that page, the next day goes (R4), the day after it still starts
--       where this one ends, and the days lead P in both units afterwards.
--       Clamping, not refusing: a write queued offline lands even when another device changed
--       the neighbours meanwhile; the answer is the read, the client asks for the days again.
--   R4  Re-chaining: start(next) := the day's new end (in its kind); a next row that then ends
--       where it starts (in the unit) is deleted. Nothing else is touched.
--   R5  P changes only when the days LEAD it (P = E_L in the unit; no rows and no value counts)
--       and the day is, or becomes, the latest row: P := the day's end. Otherwise P is untouched
--       and reading_sessions is NOT written at all, so the buddy Section trigger (D2) does not
--       run. progress_updated_at is kept (coalesce(old, now()) for a read that had no value;
--       cleared with the value when a remove takes it back to none).
--   R6  Remove = set the day to its own start: the row goes, start(next) := its start, and when it
--       was the latest and the days lead, P := its start (none clears P and its stamp). A value
--       equal to the day's start behaves the same. Removing a day without a row does nothing.
--   R7  A new row: on or after started_on and at most UTC today + 1 (the window update_progress
--       uses for every time zone); no other limit back. A row already before started_on (the
--       start date was edited later) stays editable and removable.
--   R8  Exactly one of page / percent (page within the page count that counts, percent 0-100),
--       else progress_invalid; a page on a read with no page count is refused too (the read counts
--       in percent then, and a page could not be placed between its days). The page count is not
--       an input. Known and accepted: on a very short book a percent day can stand for 0 pages
--       (2 % of 20 pages rounds to 0), so the client reads it as a day of 0 pages and hides it
--       (R12); the row stays and can be edited or removed in percent.
--   R9  Idempotent: setting a day to the end it has (in the unit) writes nothing; removing a
--       missing day writes nothing. Ordered and at most once offline through sync_write. A value
--       outside the range (only a queued write whose neighbours changed sends one) is clamped
--       against the neighbours each call meets, so repeating such a call can move on past the next
--       day the first one took away; the outbox never repeats a write (its request id).
--   R10 Open reads only: a finished or abandoned read raises not_reading, like update_progress.
--   R11 A read with a value but no rows (an import, a late first value) takes a first row from
--       none, bounded by P, and P stays.
--   R12 (what the log and the chart show) is the client's; nothing here.
--
-- A queued write names the entry, not the read: replayed after the member finished the read and
-- began it again, it lands on the NEW open read when its day is on or after that read's start
-- (before it: date_invalid for a new day), exactly as a queued update_progress does.
--
-- Errors: not_signed_in (42501); date_invalid (22023: no day, after UTC today + 1, a new row
-- before started_on); entry_not_found (P0002: not hers); not_reading (22023: no open read);
-- progress_invalid (22023).
--
-- Locks: her entry row (for update), then the open read (for update), as update_progress takes
-- them; the D2 trigger on reading_sessions then takes a room's lock only when her Section moves
-- (the order D2's header documents: entry row -> read's lock -> member rows). No new cycle.
--
-- update_progress is unchanged (the Today save: unbounded, Undo, never before the last day).
-- No table grant changes: members keep select only on reading_progress_days.

-- ------------------------------------------------------------------------- helpers

-- A value in a unit ('page' or 'percent'): none is 0; the other kind converted through the page
-- count (null when it cannot be: no page count). The client's valueIn (web/app/data/progressDays.ts),
-- in double precision and rounded half up like Math.round, so both sides agree on every value.
create function private.progress_value_in(p_page integer, p_percent integer, p_unit text, p_page_count integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_page is null and p_percent is null then 0
    when p_unit = 'page' then
      case when p_page is not null then p_page
           when coalesce(p_page_count, 0) > 0 then floor((p_percent::float8 / 100) * p_page_count + 0.5)::integer
      end
    else
      case when p_percent is not null then p_percent
           when coalesce(p_page_count, 0) > 0 then floor((p_page::float8 / p_page_count) * 100 + 0.5)::integer
      end
  end
$$;

-- The shared body: the day p_day of the locked open read p_session set to p_page | p_percent
-- (validated by the caller), or removed (p_remove). Returns the read as it is afterwards.
create function private.progress_day_write(
  p_session    public.reading_sessions,
  p_page_count integer,
  p_day        date,
  p_page       integer,
  p_percent    integer,
  p_remove     boolean
)
returns public.reading_sessions
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  v_cur        public.reading_progress_days;
  v_prev       public.reading_progress_days;
  v_next       public.reading_progress_days;
  v_last       public.reading_progress_days;
  v_has_cur    boolean;
  v_has_prev   boolean;
  v_has_next   boolean;
  v_has_last   boolean;
  v_unit       text;
  v_start_page integer;   -- the day's start, as stored
  v_start_pct  integer;
  v_start      integer;   -- and in the unit
  v_cur_end    integer;
  v_p          integer;
  v_lead       boolean;
  v_limit      integer;
  v_lo         integer;
  v_hi         integer;
  v_x          integer;
  v_end_page   integer;   -- where the day ends now, as stored (none after a remove from none)
  v_end_pct    integer;
  v_new_page   integer;
  v_new_pct    integer;
begin
  select * into v_cur from public.reading_progress_days where session_id = p_session.id and day = p_day;
  v_has_cur := found;
  if p_remove and not v_has_cur then
    return p_session;
  end if;
  select * into v_prev from public.reading_progress_days
   where session_id = p_session.id and day < p_day order by day desc limit 1;
  v_has_prev := found;
  select * into v_next from public.reading_progress_days
   where session_id = p_session.id and day > p_day order by day limit 1;
  v_has_next := found;
  select * into v_last from public.reading_progress_days
   where session_id = p_session.id order by day desc limit 1;
  v_has_last := found;

  v_unit := case
    when p_remove then case when v_cur.end_page is not null then 'page' else 'percent' end
    when p_page is not null then 'page'
    else 'percent'
  end;

  -- The day's start (R2): its own, else where the day before ended, else the base.
  if v_has_cur then
    v_start_page := v_cur.start_page;  v_start_pct := v_cur.start_percent;
  elsif v_has_prev then
    v_start_page := v_prev.end_page;   v_start_pct := v_prev.end_percent;
  elsif v_has_next then
    v_start_page := v_next.start_page; v_start_pct := v_next.start_percent;
  end if;
  v_start := coalesce(private.progress_value_in(v_start_page, v_start_pct, v_unit, p_page_count), 0);

  -- Do the days lead the read's value (R5)? No rows and no value counts as leading.
  v_p := private.progress_value_in(p_session.progress_page, p_session.progress_percent, v_unit, p_page_count);
  v_lead := v_p is not null
            and v_p = case when v_has_last
                           then private.progress_value_in(v_last.end_page, v_last.end_percent, v_unit, p_page_count)
                           else 0 end;

  if p_remove then
    v_x := v_start;
  else
    -- The range (R3), widened to the row's own end, then the clamp (lo wins over hi).
    v_limit := case when v_unit = 'page' then p_page_count else 100 end;
    v_hi := case
      when v_has_next then private.progress_value_in(v_next.end_page, v_next.end_percent, v_unit, p_page_count)
      when v_lead then v_limit
      else v_p
    end;
    v_hi := least(v_hi, v_limit);
    v_lo := v_start;
    v_x := coalesce(p_page, p_percent);
    if v_has_cur then
      v_cur_end := private.progress_value_in(v_cur.end_page, v_cur.end_percent, v_unit, p_page_count);
      v_lo := least(v_lo, v_cur_end);
      if v_hi is not null then
        v_hi := greatest(v_hi, v_cur_end);
      end if;
    end if;
    v_x := greatest(least(v_x, v_hi), v_lo);
    if v_has_cur and v_cur_end = v_x then
      return p_session;                                     -- R9: the end it has (after the clamp too)
    end if;
  end if;

  if v_x = v_start then
    -- R6: the day ends where it starts, so it has no row.
    if not v_has_cur then
      return p_session;
    end if;
    delete from public.reading_progress_days where session_id = p_session.id and day = p_day;
    v_end_page := v_start_page;
    v_end_pct  := v_start_pct;
  else
    v_end_page := case when v_unit = 'page' then v_x end;
    v_end_pct  := case when v_unit = 'percent' then v_x end;
    -- On the bound it was clamped to or set at (equal in the unit): the bound's STORED value, so
    -- the day ends exactly where the next day ended (it goes below, and the day after it still
    -- starts where this one ends) or exactly at the read's value (the days then lead it in both
    -- units). Otherwise a percent could stop a page short of the page it stands for.
    if v_has_next
       and v_x = private.progress_value_in(v_next.end_page, v_next.end_percent, v_unit, p_page_count) then
      v_end_page := v_next.end_page;
      v_end_pct  := v_next.end_percent;
    elsif not v_has_next and not v_lead and v_x = v_p
          and num_nonnulls(p_session.progress_page, p_session.progress_percent) = 1 then
      v_end_page := p_session.progress_page;
      v_end_pct  := p_session.progress_percent;
    end if;
    if v_has_cur then
      update public.reading_progress_days
         set end_page = v_end_page, end_percent = v_end_pct, updated_at = now()
       where session_id = p_session.id and day = p_day;
    else
      insert into public.reading_progress_days (session_id, day, start_page, start_percent, end_page, end_percent)
      values (p_session.id, p_day, v_start_page, v_start_pct, v_end_page, v_end_pct);
    end if;
  end if;

  -- R4: the next day starts where this one ends now; a next day that then reads nothing goes.
  if v_has_next then
    if private.progress_value_in(v_end_page, v_end_pct, v_unit, p_page_count)
       = private.progress_value_in(v_next.end_page, v_next.end_percent, v_unit, p_page_count) then
      delete from public.reading_progress_days where session_id = p_session.id and day = v_next.day;
    elsif (v_next.start_page, v_next.start_percent) is distinct from (v_end_page, v_end_pct) then
      update public.reading_progress_days
         set start_page = v_end_page, start_percent = v_end_pct, updated_at = now()
       where session_id = p_session.id and day = v_next.day;
    end if;
  end if;

  -- R5: the read's value follows only a latest day the days lead with; written only when it
  -- changes, so nothing else (the buddy Section trigger) runs for a day that leaves it alone.
  if not v_lead
     or exists (select 1 from public.reading_progress_days where session_id = p_session.id and day > p_day) then
    return p_session;
  end if;
  if num_nonnulls(v_end_page, v_end_pct) = 0 then
    if num_nonnulls(p_session.progress_page, p_session.progress_percent) = 0 then
      return p_session;
    end if;
    update public.reading_sessions
       set progress_page = null, progress_percent = null, progress_updated_at = null
     where id = p_session.id
    returning * into p_session;
    return p_session;
  end if;
  v_new_page := public.clamp_progress_page(v_end_page, p_page_count);
  v_new_pct  := v_end_pct;
  if v_p is not distinct from private.progress_value_in(v_new_page, v_new_pct, v_unit, p_page_count)
     and num_nonnulls(p_session.progress_page, p_session.progress_percent) = 1 then
    return p_session;
  end if;
  update public.reading_sessions
     set progress_page = v_new_page,
         progress_percent = v_new_pct,
         progress_updated_at = coalesce(progress_updated_at, now())
   where id = p_session.id
  returning * into p_session;
  return p_session;
end;
$$;

revoke all on function private.progress_value_in(integer, integer, text, integer) from public, anon, authenticated;
revoke all on function private.progress_day_write(public.reading_sessions, integer, date, integer, integer, boolean)
  from public, anon, authenticated;

-- -------------------------------------------------------------------------- the two calls

create function public.set_progress_day(
  p_entry_id uuid,
  p_day      date,
  p_page     integer default null,
  p_percent  integer default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_today      date := (now() at time zone 'utc')::date;
  v_override   integer;
  v_book_count integer;
  v_page_count integer;
  v_session    public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_day is null or p_day > v_today + 1 then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  -- Locked as update_progress locks them: her entry row, then the open read.
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
  v_page_count := coalesce(v_override, v_book_count);

  if num_nonnulls(p_page, p_percent) <> 1
     or (p_page is not null and (v_page_count is null or not public.progress_page_fits(p_page, v_page_count)))
     or p_percent not between 0 and 100 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;
  -- A new day is not before the read began; a day already there stays editable.
  if p_day < v_session.started_on
     and not exists (select 1 from public.reading_progress_days where session_id = v_session.id and day = p_day) then
    raise exception 'date_invalid' using errcode = '22023';
  end if;

  return private.progress_day_write(v_session, v_page_count, p_day, p_page, p_percent, false);
end;
$$;

create function public.delete_progress_day(p_entry_id uuid, p_day date)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_today      date := (now() at time zone 'utc')::date;
  v_override   integer;
  v_book_count integer;
  v_session    public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_day is null or p_day > v_today + 1 then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
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

  return private.progress_day_write(v_session, coalesce(v_override, v_book_count), p_day, null, null, true);
end;
$$;

comment on function public.set_progress_day(uuid, date, integer, integer) is
  'Where the member ended an earlier day of her open read (docs/plans/backdated-progress.md): one row '
  'per day, clamped between the neighbouring days, the next day re-chained; the read''s value moves '
  'only for the latest day when the days lead it.';
comment on function public.delete_progress_day(uuid, date) is
  'Removes a day of the member''s open read: the next day absorbs its pages; the read''s value goes '
  'back to the day''s start only when it was the latest day and the days lead it.';

revoke all on function public.set_progress_day(uuid, date, integer, integer) from public, anon;
grant execute on function public.set_progress_day(uuid, date, integer, integer) to authenticated;
revoke all on function public.delete_progress_day(uuid, date) from public, anon;
grant execute on function public.delete_progress_day(uuid, date) to authenticated;

-- ----------------------------------------------------------------- sync_write

-- The current sync_write (20261025010000_social_v2a.sql, as the schema snapshot has it) with two
-- more actions, set_progress_day and delete_progress_day. Their day is passed as queued: unlike
-- update_progress's, it is NOT moved up to yesterday (an explicit earlier day is the point), and
-- the clamp of R3 makes a write that waited land whatever the neighbours became. Nothing else changed.

create or replace function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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
        p_review     => v_args ->> 'p_review',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
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
        p_review   => v_args ->> 'p_review',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
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

    when 'set_progress_day' then
      -- An earlier day as queued: not moved into update_progress's window (see above).
      perform public.set_progress_day(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_day      => (v_args ->> 'p_day')::date,
        p_page     => (v_args ->> 'p_page')::integer,
        p_percent  => (v_args ->> 'p_percent')::integer
      );

    when 'delete_progress_day' then
      perform public.delete_progress_day(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_day      => (v_args ->> 'p_day')::date
      );

    when 'update_session' then
      perform public.update_session(
        p_session_id     => (v_args ->> 'p_session_id')::uuid,
        p_started_on     => (v_args ->> 'p_started_on')::date,
        p_ended_on       => (v_args ->> 'p_ended_on')::date,
        p_rating         => (v_args ->> 'p_rating')::integer,
        p_review         => v_args ->> 'p_review',
        p_abandon_reason => v_args ->> 'p_abandon_reason',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
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

    when 'set_entry_hidden' then
      perform public.set_entry_hidden(
        p_entry  => (v_args ->> 'p_entry')::uuid,
        p_hidden => (v_args ->> 'p_hidden')::boolean
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
  'Also takes the reader''s highlights (save_reader_highlight, issue #131), hiding a Book '
  '(set_entry_hidden, social v1), the review''s spoiler flag (social v2a) and progress on an '
  'earlier day (set_progress_day, delete_progress_day).';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;
