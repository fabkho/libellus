CREATE OR REPLACE FUNCTION private.cover_allowed(p_url text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select coalesce(
    p_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|i\.gr-assets\.com|([a-z0-9-]+\.)+mzstatic\.com)(/|$)',
    false)
$function$
;
