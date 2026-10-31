CREATE OR REPLACE FUNCTION public.match_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, replace(coalesce(p_text, ''), '&', ' and '))),
    '[^a-z0-9]+', ' ', 'g'))
$function$
;
