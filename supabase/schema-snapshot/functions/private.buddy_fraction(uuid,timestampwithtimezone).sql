CREATE OR REPLACE FUNCTION private.buddy_fraction(p_entry uuid, p_joined timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_session public.reading_sessions;
  v_pages   integer;
begin
  if p_entry is null or p_joined is null then
    return null;
  end if;

  select s.* into v_session
    from public.reading_sessions s
   where s.entry_id = p_entry
     and (s.outcome is null
          or coalesce(s.ended_on, s.started_on) >= (p_joined at time zone 'utc')::date)
   order by (s.outcome is null) desc, coalesce(s.ended_on, s.started_on) desc, s.created_at desc, s.id
   limit 1;
  if not found then
    return null;
  end if;

  if v_session.outcome = 'finished' then
    return 1;
  end if;
  if v_session.progress_page is not null then
    select coalesce(e.page_count_override, b.page_count) into v_pages
      from public.library_entries e
      join public.books b on b.id = e.book_id
     where e.id = p_entry;
    if v_pages is null then
      return null;
    end if;
    return least(1::numeric, v_session.progress_page::numeric / v_pages);
  end if;
  if v_session.progress_percent is not null then
    return v_session.progress_percent::numeric / 100;
  end if;
  return 0;
end;
$function$
;
