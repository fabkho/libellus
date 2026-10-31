CREATE OR REPLACE FUNCTION public.search_books(p_query text, p_limit integer DEFAULT 20)
 RETURNS SETOF books
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  -- No bound on the query was a free 8 s of CPU per call (F14, 20261022010000); the app never sends more.
  v_query  text := left(p_query, 200);
  v_isbn13 text := regexp_replace(coalesce(v_query, ''), '[\s-]', '', 'g');
  v_words  tsquery;
  v_text   text;
begin
  if v_isbn13 ~ '^97[89][0-9]{10}$' then
    return query
      select books.* from public.books
       where books.isbn13 = v_isbn13
         -- books_readable, word for word
         and (books.owner_id is null or books.owner_id = (select auth.uid()))
         and private.book_shown(books)
       order by books.owner_id is null, books.created_at desc, books.id
       limit v_limit;
    return;
  end if;

  v_words := public.book_search_query(v_query);
  if v_words is null then
    return;
  end if;
  v_text := btrim(public.book_search_text(v_query, '{}'));
  return query
    select books.* from private.book_search s
      join public.books on books.id = s.book_id
     where s.words @@ v_words
       -- books_readable, word for word
       and (books.owner_id is null or books.owner_id = (select auth.uid()))
       and private.book_shown(books)
     order by s.title = v_text desc,
              ts_rank(s.words, v_words) desc,
              books.created_at desc,
              books.id
     limit v_limit;
end;
$function$
;
