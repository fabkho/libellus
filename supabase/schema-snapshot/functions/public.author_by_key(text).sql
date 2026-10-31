CREATE OR REPLACE FUNCTION public.author_by_key(p_author text)
 RETURNS authors
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_author public.authors;
begin
  if p_author ~ '^Q[1-9][0-9]{0,11}$' then
    select * into v_author from public.authors where wikidata_id = p_author;
  elsif p_author ~ '^OL[1-9][0-9]{0,11}A$' then
    select * into v_author from public.authors where openlibrary_key = p_author;
  elsif p_author ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_author from public.authors where id = p_author::uuid;
  end if;
  return v_author;
end;
$function$
;
