CREATE OR REPLACE FUNCTION private.rating_from_review_text(p_text text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select case when floor(private.rating_text_stars(p_text) * 4) >= 1 then floor(private.rating_text_stars(p_text) * 4)::integer end
$function$
;
