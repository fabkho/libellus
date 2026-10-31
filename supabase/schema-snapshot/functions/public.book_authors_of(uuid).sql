CREATE OR REPLACE FUNCTION public.book_authors_of(p_book uuid)
 RETURNS TABLE(credit_position smallint, name text, author_id uuid, author_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select ba.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.book_authors ba
    join public.authors a on a.id = ba.author_id
   where ba.book_id = p_book
   order by ba.position
$function$
;
