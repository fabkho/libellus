CREATE OR REPLACE FUNCTION private.buddy_parts(p_read uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select count(*)::integer from public.buddy_read_sections where buddy_read_id = p_read and kind = 'part'
$function$
;
