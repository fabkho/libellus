CREATE OR REPLACE FUNCTION private.member_name(p_member uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'auth'
AS $function$
  select nullif(left(btrim(raw_user_meta_data ->> 'name'), 40), '') from auth.users where id = p_member
$function$
;
