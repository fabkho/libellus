CREATE OR REPLACE FUNCTION private.reading_page_reads(p_member uuid)
 RETURNS TABLE(entry_id uuid, book_id uuid, session_id uuid, started_on date, ended_on date, rating smallint, review text, pages integer, created_at timestamp with time zone, nth bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select e.id, e.book_id, s.id, s.started_on, s.ended_on, s.rating, s.review,
         coalesce(e.page_count_override, b.page_count), s.created_at,
         row_number() over (partition by e.id order by s.ended_on nulls first, s.created_at)
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and not e.hidden and s.outcome = 'finished'
$function$
;
