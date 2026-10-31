CREATE OR REPLACE FUNCTION private.like_count(p_session uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select count(*)::integer from private.allowed_likes(p_session)
$function$
;
