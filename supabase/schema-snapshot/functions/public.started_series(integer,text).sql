CREATE OR REPLACE FUNCTION public.started_series(p_limit integer DEFAULT 50, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select public.started_series_items(p_limit, p_language, false)
$function$
;
