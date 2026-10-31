CREATE OR REPLACE FUNCTION private.cover_gc_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select enabled from private.cover_store_settings where id), false)
$function$
;
