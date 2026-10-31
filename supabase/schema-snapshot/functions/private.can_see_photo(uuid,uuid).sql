CREATE OR REPLACE FUNCTION private.can_see_photo(p_caller uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select p_caller is not null and p_owner is not null
     and (p_caller = p_owner or private.reachable(p_caller, p_owner))
$function$
;
