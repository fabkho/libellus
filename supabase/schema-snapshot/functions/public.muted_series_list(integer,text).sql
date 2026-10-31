CREATE OR REPLACE FUNCTION public.muted_series_list(p_limit integer DEFAULT 50, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case
    when exists (select 1 from public.muted_series ms where ms.member_id = (select auth.uid()))
    then public.started_series_items(p_limit, p_language, true)
    else '[]'::jsonb
  end
$function$
;
