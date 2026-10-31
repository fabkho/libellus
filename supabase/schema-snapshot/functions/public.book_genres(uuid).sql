CREATE OR REPLACE FUNCTION public.book_genres(p_book uuid)
 RETURNS TABLE(genre_id text, rank smallint, source text, overridden boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with mine as (
    select g.genre_ids
      from public.entry_genres g
      join public.library_entries e on e.id = g.entry_id
     where e.book_id = p_book and e.member_id = (select auth.uid())
     limit 1
  )
  select t.id, t.n::smallint, 'member', true
    from mine, unnest(mine.genre_ids) with ordinality as t(id, n)
  union all
  select bg.genre_id, bg.rank, bg.source, false
    from public.book_genres bg
   where bg.book_id = p_book
     and not exists (select 1 from mine)
  order by 2
$function$
;
