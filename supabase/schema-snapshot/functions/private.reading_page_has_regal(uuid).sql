CREATE OR REPLACE FUNCTION private.reading_page_has_regal(p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select exists (select 1 from private.shelf_publish where owner_id = p_member)
$function$
;
