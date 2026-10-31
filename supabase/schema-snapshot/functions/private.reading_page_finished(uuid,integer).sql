CREATE OR REPLACE FUNCTION private.reading_page_finished(p_member uuid, p_limit integer)
 RETURNS TABLE(book_id uuid, ended_on date, rating smallint, review text, review_spoilers boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select book_id, ended_on, rating, review, review_spoilers from (
    select distinct on (r.book_id) r.book_id, r.ended_on, r.rating, r.review, r.created_at,
           (select s.review_spoilers from public.reading_sessions s where s.id = r.session_id) as review_spoilers
      from private.reading_page_reads(p_member) r
     order by r.book_id, r.ended_on desc nulls last, r.created_at desc
  ) latest
  order by ended_on desc nulls last, created_at desc
  limit p_limit
$function$
;
