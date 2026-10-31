CREATE OR REPLACE FUNCTION public.authors_by_ref(p_work text, p_names text[], p_keys text[])
 RETURNS TABLE(ref text, credit_position smallint, name text, author_id uuid, author_key text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select a.openlibrary_key, 1::smallint, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.authors a
   where a.openlibrary_key = any(coalesce(p_keys[1:20], '{}'))
  union all
  select null, wa.position, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from public.works w
    join public.work_authors wa on wa.work_id = w.id
    join public.authors a on a.id = wa.author_id
   where w.openlibrary_key = p_work
  union all
  select n.name, 1::smallint, a.name, a.id, coalesce(a.wikidata_id, a.openlibrary_key, a.id::text)
    from unnest(coalesce(p_names[1:20], '{}')) as n(name)
    cross join lateral (
      select x.*
        from public.authors x
       where public.author_name_key(x.name) = public.author_name_key(n.name)
       order by (select count(*) from public.work_authors w where w.author_id = x.id) desc,
                (x.wikidata_id is not null) desc, x.created_at, x.id
       limit 1
    ) a
   where public.author_name_key(n.name) <> ''
$function$
;
