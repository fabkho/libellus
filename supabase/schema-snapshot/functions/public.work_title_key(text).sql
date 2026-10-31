CREATE OR REPLACE FUNCTION public.work_title_key(p_title text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select coalesce(
    nullif(public.match_text(split_part(
      regexp_replace(regexp_replace(coalesce(p_title, ''), '\s*[(\[][^()\[\]]*[)\]]', ' ', 'g'), '\s+', ' ', 'g'),
      ':', 1)), ''),
    public.match_text(p_title))
$function$
;
