CREATE OR REPLACE FUNCTION public.author_page(p_author text, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with a as (
    select * from public.author_by_key(p_author) where id is not null
  ),
  aw as (
    select w.* from public.works w
      join public.work_authors wa on wa.work_id = w.id
     where wa.author_id = (select id from a)
  ),
  -- Each work's series with a position, the most specific one only.
  placed as (
    select distinct on (aw.id) aw.id as work_id, ws.series_id, ws.position
      from aw
      join public.work_series ws on ws.work_id = aw.id and ws.position is not null
      join public.series s on s.id = ws.series_id
     order by aw.id, (select count(*) from public.series c where c.parent_id = s.id), s.parent_id is null, s.name
  ),
  series_groups as (
    select s.id, s.name, s.parent_id, s.wikidata_id,
           jsonb_agg(public.work_card(aw.id, p_language, p.position) order by p.position, aw.first_year) as works,
           min(aw.first_year) as first_year
      from placed p
      join aw on aw.id = p.work_id
      join public.series s on s.id = p.series_id
     group by s.id
  ),
  unplaced as (
    select aw.* from aw where not exists (select 1 from placed p where p.work_id = aw.id)
  ),
  -- Her Books credited to the author whose work is not among the works.
  her_books as (
    select jsonb_strip_nulls(jsonb_build_object(
             'title', b.title, 'year', b.published_year, 'coverUrl', b.cover_url,
             'coverKey', b.cover_key, 'coverWidths', b.cover_widths,
             'entry', jsonb_strip_nulls(jsonb_build_object('entryId', e.id, 'bookId', b.id, 'status', e.status))
           )) as card, b.published_year
      from public.book_authors ba
      join public.books b on b.id = ba.book_id
      join public.library_entries e on e.book_id = b.id and e.member_id = (select auth.uid())
     where ba.author_id = (select id from a)
       and not exists (select 1 from public.book_works bw join aw on aw.id = bw.work_id where bw.book_id = b.id)
  ),
  genre_counts as (
    select g.genre, count(*) as n
      from (select unnest(aw.genre_ids) as genre from aw
            union all
            select bg.genre_id from public.book_genres bg
              join public.book_authors ba on ba.book_id = bg.book_id and ba.author_id = (select id from a)
             where bg.rank = 1) g
     group by g.genre
  )
  select jsonb_build_object(
    'author', jsonb_strip_nulls(jsonb_build_object(
      'id', a.id,
      'key', coalesce(a.wikidata_id, a.openlibrary_key, a.id::text),
      'name', a.name,
      'wikidataId', a.wikidata_id,
      'openLibraryKey', a.openlibrary_key,
      'born', case when a.birth_date is not null then jsonb_build_object('date', a.birth_date, 'precision', a.birth_precision) end,
      'died', case when a.death_date is not null then jsonb_build_object('date', a.death_date, 'precision', a.death_precision) end,
      'photo', case when a.photo_url is not null then jsonb_build_object('url', a.photo_url, 'credit', a.photo_credit) end,
      'summary', coalesce(
        case when a.summaries ? p_language then a.summaries -> p_language || jsonb_build_object('language', p_language) end,
        case when a.summaries ? 'en' then a.summaries -> 'en' || jsonb_build_object('language', 'en') end),
      'fetchedAt', a.fetched_at
    )),
    'genres', coalesce((select jsonb_agg(gc.genre order by gc.n desc, g.position)
                          from (select * from genre_counts order by n desc limit 4) gc
                          join public.genres g on g.id = gc.genre), '[]'),
    'series', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'id', sg.id, 'name', sg.name, 'wikidataId', sg.wikidata_id, 'parentId', sg.parent_id,
                                 'parentName', (select p.name from public.series p where p.id = sg.parent_id),
                                 'works', sg.works))
                               order by sg.parent_id is null, sg.first_year nulls last, sg.name)
                          from series_groups sg), '[]'),
    'standalone', coalesce((select jsonb_agg(public.work_card(u.id, p_language) order by u.first_year nulls last, u.title)
                              from unplaced u where u.kind in ('novel', 'novella')), '[]'),
    'other', coalesce((select jsonb_agg(card order by year nulls last, card ->> 'title')
                         from (select public.work_card(u.id, p_language) as card, u.first_year as year
                                 from unplaced u where u.kind is null or u.kind not in ('novel', 'novella')
                               union all
                               select card, published_year from her_books) o), '[]'),
    'stale', a.fetched_at is null or a.works_fetched_at is null or a.fetched_at < now() - interval '30 days'
  )
  from a
$function$
;
