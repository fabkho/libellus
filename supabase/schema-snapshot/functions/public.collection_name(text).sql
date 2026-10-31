CREATE OR REPLACE FUNCTION public.collection_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when char_length(v) between 1 and 80 then v
  end
  from (select btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')) as v) t
$function$
;
