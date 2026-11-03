CREATE OR REPLACE FUNCTION private.buddy_hidden(p_caller uuid, p_author uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select p_author is distinct from p_caller and private.blocked_either(p_caller, p_author)
$function$
;
