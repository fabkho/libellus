CREATE OR REPLACE FUNCTION public.read_as_for_format(p_format book_format)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case p_format
    when 'hardcover' then 'physical'
    when 'paperback' then 'physical'
    when 'ebook' then 'ebook'
    when 'audiobook' then 'audiobook'
  end
$function$
;
