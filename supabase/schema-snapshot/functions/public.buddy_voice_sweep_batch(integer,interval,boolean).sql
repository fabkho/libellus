CREATE OR REPLACE FUNCTION public.buddy_voice_sweep_batch(p_limit integer DEFAULT 100, p_grace interval DEFAULT '06:00:00'::interval, p_orphans boolean DEFAULT true)
 RETURNS text[]
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select coalesce(array_agg(e.item ->> 'path' order by e.n), '{}')
    from jsonb_array_elements(private.voice_sweep_pick(array['buddy-voice'], p_limit, p_grace, p_orphans)) with ordinality e(item, n)
$function$
;
