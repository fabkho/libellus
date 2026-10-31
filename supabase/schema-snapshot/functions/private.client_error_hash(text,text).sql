CREATE OR REPLACE FUNCTION private.client_error_hash(p_kind text, p_message text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select md5(p_kind || chr(10) || p_message)
$function$
;
