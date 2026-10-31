CREATE OR REPLACE FUNCTION public.goodreads_rating(books)
 RETURNS SETOF goodreads_ratings
 LANGUAGE sql
 STABLE ROWS 1
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select g.*
    from public.goodreads_ratings g
   where g.isbn13 = $1.isbn13
     and g.status = 'found'
$function$
;
