CREATE OR REPLACE FUNCTION private.cover_artwork(p_url text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case
    when p_url is null then null
    when p_url ~* '^https://covers\.openlibrary\.org/' then
      regexp_replace(regexp_replace(p_url, '-[SML]\.jpg(?=\?|$)', '-M.jpg'), '[?&]default=false$', '')
    else
      regexp_replace(p_url, '/\d+x\d+bb\.(jpg|jpeg|png|webp)$', '/1x1bb.jpg')
  end
$function$
;
