CREATE OR REPLACE FUNCTION private.is_instance_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select o.owner_id = (select auth.uid()) from private.instance_owner o),
    false)
$function$
;
