CREATE OR REPLACE FUNCTION public.book_search_text(p_title text, p_authors text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(p_title, '') || ' ' || coalesce(array_to_string(p_authors, ' '), '')
  ))
$function$
;
