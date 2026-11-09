CREATE OR REPLACE FUNCTION public.buddy_voice_sweep_done(p_paths text[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  delete from private.buddy_voice_trash where bucket = 'buddy-voice' and path = any (coalesce(p_paths, '{}'))
$function$
;
