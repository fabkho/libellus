CREATE OR REPLACE FUNCTION private.review_folded(p_caller uuid, p_owner uuid, p_book uuid, p_spoilers boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select coalesce(p_spoilers, false)
     and p_caller is distinct from p_owner
     and not private.finished_same_book(p_caller, p_book)
$function$
;
