CREATE OR REPLACE FUNCTION private.member_topic(p_member uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select 'member:' || p_member::text
$function$
;
