CREATE OR REPLACE FUNCTION private.cover_shown(p_book books)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select private.cover_allowed(p_book.cover_url)
$function$
;
