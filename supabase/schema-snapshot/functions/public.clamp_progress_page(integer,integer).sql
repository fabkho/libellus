CREATE OR REPLACE FUNCTION public.clamp_progress_page(p_page integer, p_page_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_page is null or p_page_count is null then p_page
    else least(p_page, greatest(p_page_count, 0))
  end
$function$
;
