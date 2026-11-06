CREATE OR REPLACE FUNCTION private.notes_lock(p_kind text, p_key text)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select pg_advisory_xact_lock(hashtextextended(p_kind || ':' || p_key, 0))
$function$
;
