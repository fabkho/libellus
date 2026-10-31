CREATE OR REPLACE FUNCTION public.series_works(p_series uuid, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with s as (
    select * from public.series where id = p_series
  ),
  computed as (
    select ws.position, public.work_card(w.id, p_language, ws.position) as card, w.id as work_id
      from public.work_series ws
      join public.works w on w.id = ws.work_id
     where ws.series_id = p_series
  ),
  -- Her entries she placed here herself, unless their work is listed already.
  hers as (
    select es.position,
           jsonb_strip_nulls(jsonb_build_object(
             'title', b.title, 'coverUrl', b.cover_url, 'year', b.published_year, 'position', es.position,
             'coverKey', b.cover_key, 'coverWidths', b.cover_widths,
             'source', 'member',
             'entry', jsonb_strip_nulls(jsonb_build_object('entryId', e.id, 'bookId', e.book_id, 'status', e.status))
           )) as card
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
      join public.books b on b.id = e.book_id
     where es.series_id = p_series
       and es.member_id = (select auth.uid())
       and not exists (select 1 from public.book_works bw join computed c on c.work_id = bw.work_id
                        where bw.book_id = e.book_id)
  )
  select jsonb_build_object(
    'id', s.id, 'name', s.name, 'wikidataId', s.wikidata_id, 'parentId', s.parent_id,
    'parentName', (select p.name from public.series p where p.id = s.parent_id),
    'source', s.source,
    -- "Book 2 of 9": the whole-numbered positions.
    'count', (select count(distinct position) from (select position from computed union all select position from hers) a
               where position is not null and position = trunc(position)),
    'works', coalesce((select jsonb_agg(card order by position nulls last, card ->> 'year', card ->> 'title')
                         from (select position, card from computed union all select position, card from hers) a), '[]')
  )
  from s
$function$
;
