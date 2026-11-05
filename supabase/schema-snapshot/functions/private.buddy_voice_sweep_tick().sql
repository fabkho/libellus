CREATE OR REPLACE FUNCTION private.buddy_voice_sweep_tick()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select private.buddy_voice_kick(true, true)
$function$
;
