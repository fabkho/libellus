CREATE OR REPLACE FUNCTION public.cover_store_kick(p_now boolean DEFAULT false)
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.cover_store_kick(p_now)
$function$
;
