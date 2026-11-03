CREATE OR REPLACE FUNCTION private.progress_value_in(p_page integer, p_percent integer, p_unit text, p_page_count integer)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_page is null and p_percent is null then 0
    when p_unit = 'page' then
      case when p_page is not null then p_page
           when coalesce(p_page_count, 0) > 0 then floor((p_percent::float8 / 100) * p_page_count + 0.5)::integer
      end
    else
      case when p_percent is not null then p_percent
           when coalesce(p_page_count, 0) > 0 then floor((p_page::float8 / p_page_count) * 100 + 0.5)::integer
      end
  end
$function$
;
