CREATE OR REPLACE FUNCTION public.progress_page_fits(p_page integer, p_page_count integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select p_page >= 0 and (p_page_count is null or p_page <= p_page_count)
$function$
;
