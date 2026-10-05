-- Undo of a read's first progress save goes back to "no progress" (issue #104).
--
-- Until now a read that had no progress could not get back to it: Undo of the
-- first save wrote page 0 (or 0 %), and the client treated 0 as "nothing
-- tracked". The database kept a value where there had been none (a read with
-- `progress_page = 0` is not the same as one without, and a native client has to
-- know to treat them alike).
--
-- `update_progress` takes one more argument, `p_clear` (default false): with it
-- the open read's progress goes back to none (`progress_page`, `progress_percent`
-- and `progress_updated_at` all null), whatever it was. It names no value:
-- `p_clear` together with a page or a percent is `progress_invalid`. It may come
-- with the total (`p_set_page_count`), as an Undo of a first save that also set
-- the member's own total does. Both values null without `p_clear` is refused as
-- before, so a call that forgot its value never clears by accident. A read that
-- has no progress already is left as it is (nothing to clear, no day).
--
-- The day of the read is booked as for a return to 0 in the unit the read had
-- (the day's end moves to 0; a day that began with no progress and ends there
-- has no row, so the Undo of a first save takes its day away, as it did).
--
-- A new signature, so the old one goes. `sync_write` forwards `p_clear`, so a
-- queued Undo clears the same way after it waited offline (docs/parity.md,
-- Save offline and sync later).

drop function public.update_progress(uuid, integer, integer, boolean, integer, date);

create function public.update_progress(
  p_entry_id       uuid,
  p_page           integer default null,
  p_percent        integer default null,
  p_set_page_count boolean default false,
  p_page_count     integer default null,
  p_day            date default null,
  p_clear          boolean default false
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
  v_page       integer := p_page;
  v_percent    integer := p_percent;
  v_cleared    boolean;
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

  -- p_clear takes the read's progress back to none, so it names no value; the
  -- total may go with it (Undo of a first save that also set the total).
  if num_nonnulls(p_page, p_percent) > 1
     or (p_clear and num_nonnulls(p_page, p_percent) > 0)
     or (num_nonnulls(p_page, p_percent) = 0 and not p_set_page_count and not p_clear)
     or (p_page is not null and not public.progress_page_fits(p_page, v_page_count))
     or p_percent not between 0 and 100 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  if p_set_page_count then
    update public.library_entries set page_count_override = v_override where id = p_entry_id;
    perform public.clamp_session_progress(p_entry_id, v_page_count);
  end if;

  -- Cleared: none again (progress_updated_at is null exactly then). The day
  -- books it as a return to 0 in the unit the read had, so the day it undoes
  -- ends where it started and has no row.
  v_cleared := p_clear and num_nonnulls(v_before.progress_page, v_before.progress_percent) = 1;
  if v_cleared then
    v_page    := case when v_before.progress_page is not null then 0 end;
    v_percent := case when v_before.progress_percent is not null then 0 end;
  end if;

  if num_nonnulls(v_page, v_percent) = 1 then
    update public.reading_sessions
       set progress_page       = case when v_cleared then null else p_page end,
           progress_percent    = case when v_cleared then null else p_percent end,
           progress_updated_at = case when v_cleared then null else now() end
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
    values (v_session.id, v_day, v_before.progress_page, v_before.progress_percent, v_page, v_percent)
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

revoke all on function public.update_progress(uuid, integer, integer, boolean, integer, date, boolean) from public, anon;
grant execute on function public.update_progress(uuid, integer, integer, boolean, integer, date, boolean) to authenticated;

-- ----------------------------------------------------------------- sync_write

-- #93's sync_write, forwarding `p_clear` to update_progress; nothing else changed.
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
  'call uses, at most once per p_request_id: a second send answers with the first result.';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;
