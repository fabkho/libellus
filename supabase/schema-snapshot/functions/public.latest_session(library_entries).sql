CREATE OR REPLACE FUNCTION public.latest_session(library_entries)
 RETURNS SETOF reading_sessions
 LANGUAGE sql
 STABLE ROWS 1
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select s.*
    from public.reading_sessions s
   where s.entry_id = $1.id
   order by s.outcome is null desc, s.ended_on desc nulls last, s.started_on desc nulls last,
            s.created_at desc
   limit 1
$function$
;
