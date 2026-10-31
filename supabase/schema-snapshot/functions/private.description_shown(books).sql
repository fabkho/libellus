CREATE OR REPLACE FUNCTION private.description_shown(p_book books)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_book.checked_at is not null and not p_book.check_failed and not p_book.check_unknown
$function$
;
