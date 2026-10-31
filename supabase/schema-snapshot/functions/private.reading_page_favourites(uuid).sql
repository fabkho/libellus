CREATE OR REPLACE FUNCTION private.reading_page_favourites(p_member uuid)
 RETURNS TABLE(book_id uuid, rating smallint, ended_on date)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select book_id, rating, ended_on from (
    select distinct on (r.book_id) r.book_id, r.rating, r.ended_on, r.created_at
      from private.reading_page_reads(p_member) r
     where r.rating >= 16
     order by r.book_id, r.rating desc, r.ended_on desc nulls last, r.created_at desc
  ) best
  order by rating desc, ended_on desc nulls last, created_at desc
  limit 12
$function$
;
