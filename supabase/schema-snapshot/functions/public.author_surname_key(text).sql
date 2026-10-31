CREATE OR REPLACE FUNCTION public.author_surname_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select coalesce(substring(public.match_text(p_name) from '[^ ]+$'), '')
$function$
;
