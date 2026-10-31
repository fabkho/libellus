CREATE OR REPLACE FUNCTION public.started_series_items(p_limit integer, p_language text, p_muted boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.started_series_core(p_limit, p_language, not p_muted, p_muted)
         -> (case when p_muted then 'muted' else 'open' end)
$function$
;
