CREATE OR REPLACE FUNCTION public.enrich_save_genres(p_book uuid, p_genres jsonb, p_map_version integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  delete from public.book_genres where book_id = p_book;
  insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
  select p_book, g ->> 'genre', (g ->> 'rank')::smallint, g ->> 'source', (g ->> 'confidence')::real, p_map_version
    from jsonb_array_elements(coalesce(p_genres, '[]')) g;
  update public.book_enrichment set map_version = p_map_version where book_id = p_book;
end;
$function$
;
