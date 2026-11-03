CREATE OR REPLACE FUNCTION private.buddy_lock_member(p_member uuid)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_advisory_xact_lock(hashtextextended('buddy:' || p_member::text, 0))
$function$
;
