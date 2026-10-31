CREATE OR REPLACE FUNCTION private.reading_page_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_')
$function$
;
