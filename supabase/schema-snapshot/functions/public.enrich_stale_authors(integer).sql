CREATE OR REPLACE FUNCTION public.enrich_stale_authors(p_limit integer DEFAULT 5)
 RETURNS SETOF authors
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select a.*
    from public.authors a
   where (a.fetched_at is null or a.fetched_at < now() - interval '30 days'
          or a.works_fetched_at is null)
     and (a.wikidata_id is not null or a.openlibrary_key is not null)
     and exists (select 1 from public.book_authors ba
                   join public.library_entries e on e.book_id = ba.book_id
                  where ba.author_id = a.id)
   order by a.fetched_at nulls first, a.created_at
   limit greatest(0, least(coalesce(p_limit, 5), 100))
$function$
;
