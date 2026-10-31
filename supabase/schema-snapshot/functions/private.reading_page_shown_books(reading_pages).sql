CREATE OR REPLACE FUNCTION private.reading_page_shown_books(p_page reading_pages)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select book_id from private.reading_page_reading(p_page.member_id) where p_page.show_reading
  union
  select book_id from private.reading_page_favourites(p_page.member_id) where p_page.show_favourites
  union
  select book_id from private.reading_page_finished(p_page.member_id, 12) where p_page.show_finished
  union
  select book_id from private.reading_page_finished(p_page.member_id, 60)
   where p_page.show_shelf and not private.reading_page_has_regal(p_page.member_id)
$function$
;
