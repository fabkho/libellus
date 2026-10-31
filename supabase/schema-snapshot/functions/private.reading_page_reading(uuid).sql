CREATE OR REPLACE FUNCTION private.reading_page_reading(p_member uuid)
 RETURNS TABLE(book_id uuid, started_on date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select e.book_id, s.started_on
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
   where e.member_id = p_member and not e.hidden
   order by s.started_on desc nulls last, s.created_at desc
   limit 6
$function$
;
