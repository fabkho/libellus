CREATE OR REPLACE FUNCTION public.library_genres()
 RETURNS TABLE(entry_id uuid, book_id uuid, genre_ids text[], overridden boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select e.id,
         e.book_id,
         coalesce(g.genre_ids,
                  array(select bg.genre_id from public.book_genres bg
                         where bg.book_id = e.book_id order by bg.rank),
                  '{}'),
         g.entry_id is not null
    from public.library_entries e
    left join public.entry_genres g on g.entry_id = e.id
   where e.member_id = (select auth.uid())
$function$
;
