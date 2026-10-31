CREATE OR REPLACE FUNCTION public.book_authors_for(p_books uuid[])
 RETURNS TABLE(book_id uuid, credit_position smallint, name text, author_id uuid, author_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select ba.book_id, ba.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.book_authors ba
    join public.authors a on a.id = ba.author_id
   where ba.book_id = any(p_books)
   order by ba.book_id, ba.position
$function$
;
