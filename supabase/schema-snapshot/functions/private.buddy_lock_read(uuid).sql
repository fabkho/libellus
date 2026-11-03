CREATE OR REPLACE FUNCTION private.buddy_lock_read(p_read uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_advisory_xact_lock(hashtextextended('buddy_read:' || p_read::text, 0))
$function$
;
