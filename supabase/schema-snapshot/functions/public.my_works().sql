CREATE OR REPLACE FUNCTION public.my_works()
 RETURNS TABLE(work_id uuid, entry_id uuid, book_id uuid, status entry_status, rating smallint, finished_on date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select distinct on (bw.work_id)
         bw.work_id, e.id, e.book_id, e.status, last_read.rating, last_read.ended_on
    from public.library_entries e
    join public.book_works bw on bw.book_id = e.book_id
    left join lateral (
      select s.rating, s.ended_on
        from public.reading_sessions s
       where s.entry_id = e.id and s.outcome = 'finished'
       order by s.ended_on desc nulls last, s.created_at desc
       limit 1
    ) last_read on true
   where e.member_id = (select auth.uid())
   order by bw.work_id,
            case e.status when 'finished' then 0 when 'reading' then 1 else 2 end,
            e.added_at desc
$function$
;
