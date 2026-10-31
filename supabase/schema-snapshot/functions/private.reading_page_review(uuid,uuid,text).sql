CREATE OR REPLACE FUNCTION private.reading_page_review(p_member uuid, p_book uuid, p_review text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case when exists (
    select 1 from public.reading_page_books where member_id = p_member and book_id = p_book and review
  ) then p_review end
$function$
;
