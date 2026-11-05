CREATE OR REPLACE FUNCTION public.delete_progress_day(p_entry_id uuid, p_day date)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
