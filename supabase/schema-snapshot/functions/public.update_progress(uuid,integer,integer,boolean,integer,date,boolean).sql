CREATE OR REPLACE FUNCTION public.update_progress(p_entry_id uuid, p_page integer DEFAULT NULL::integer, p_percent integer DEFAULT NULL::integer, p_set_page_count boolean DEFAULT false, p_page_count integer DEFAULT NULL::integer, p_day date DEFAULT NULL::date, p_clear boolean DEFAULT false)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
