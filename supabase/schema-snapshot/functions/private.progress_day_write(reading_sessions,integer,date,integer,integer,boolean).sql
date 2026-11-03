CREATE OR REPLACE FUNCTION private.progress_day_write(p_session reading_sessions, p_page_count integer, p_day date, p_page integer, p_percent integer, p_remove boolean)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
$function$
;
