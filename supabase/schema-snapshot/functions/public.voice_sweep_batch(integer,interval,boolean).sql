CREATE OR REPLACE FUNCTION public.voice_sweep_batch(p_limit integer DEFAULT 100, p_grace interval DEFAULT '06:00:00'::interval, p_orphans boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.voice_sweep_pick(array['buddy-voice', 'note-voice'], p_limit, p_grace, p_orphans)
$function$
;
