CREATE OR REPLACE FUNCTION private.social_book_json(p_book books)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.reading_page_book_json(p_book)
         || jsonb_build_object('manual', p_book.owner_id is not null)
$function$
;
