CREATE OR REPLACE FUNCTION public.author_name_key(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select btrim(lower(extensions.unaccent('extensions.unaccent'::regdictionary, regexp_replace(coalesce(p_name, ''), '[.[:space:]]+', ' ', 'g'))))
$function$
;
