CREATE OR REPLACE FUNCTION private.reading_page_name(p_member uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'auth'
AS $function$
  select nullif(btrim(raw_user_meta_data ->> 'name'), '') from auth.users where id = p_member
$function$
;
