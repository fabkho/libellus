CREATE OR REPLACE FUNCTION private.cover_storable(p_url text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select private.cover_allowed(p_url) and p_url !~* '^https://books\.google\.com/'
$function$
;
