CREATE OR REPLACE FUNCTION public.book_series_info(p_book uuid, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with mine as (
    select es.series_id, es.position
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
     where e.book_id = p_book and e.member_id = (select auth.uid())
     limit 1
  ),
  memberships as (
    select series_id, position, 'member' as source from mine where series_id is not null
    union all
    select bs.series_id, bs.position, bs.source
      from public.book_series bs
     where bs.book_id = p_book and not exists (select 1 from mine)
  )
  select jsonb_build_object(
    'overridden', exists (select 1 from mine),
    'series', coalesce((
      select jsonb_agg(public.series_works(m.series_id, p_language)
                       || jsonb_strip_nulls(jsonb_build_object('position', m.position, 'membership', m.source))
                       order by (select count(*) from public.series c where c.parent_id = m.series_id),
                                s.parent_id is null, s.name)
        from memberships m
        join public.series s on s.id = m.series_id
       where s.created_by is null or s.created_by = (select auth.uid())
    ), '[]')
  )
$function$
;
