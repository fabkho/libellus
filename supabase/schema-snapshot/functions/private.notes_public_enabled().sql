CREATE OR REPLACE FUNCTION private.notes_public_enabled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select s.public_enabled from private.notes_settings s where s.id), false)
$function$
;
