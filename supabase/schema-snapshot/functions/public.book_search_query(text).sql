CREATE OR REPLACE FUNCTION public.book_search_query(p_query text)
 RETURNS tsquery
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select pg_catalog.to_tsquery(
    'pg_catalog.simple'::regconfig,
    pg_catalog.string_agg(pg_catalog.quote_literal(word) || ':*', ' & ' order by n)
  )
  from pg_catalog.regexp_split_to_table(public.book_search_text(p_query, '{}'), '[^[:alnum:]]+')
       with ordinality as t(word, n)
  where word <> ''
$function$
;
