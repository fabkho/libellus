CREATE OR REPLACE FUNCTION public.next_in_series(p_limit integer DEFAULT 5, p_language text DEFAULT 'en'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with mine as (select * from public.my_works()),
  -- Every (series, position) she has an entry at, with its status.
  her_places as (
    select ws.series_id, ws.position, m.status, m.finished_on, m.work_id,
           (select w.title from public.works w where w.id = m.work_id) as title
      from mine m
      join public.work_series ws on ws.work_id = m.work_id
     where ws.position is not null
       and not exists (select 1 from public.entry_series es where es.entry_id = m.entry_id)
    union all
    select es.series_id, es.position, e.status,
           (select max(s.ended_on) from public.reading_sessions s where s.entry_id = e.id and s.outcome = 'finished'),
           (select bw.work_id from public.book_works bw where bw.book_id = e.book_id),
           b.title
      from public.entry_series es
      join public.library_entries e on e.id = es.entry_id
      join public.books b on b.id = e.book_id
     where es.member_id = (select auth.uid()) and es.series_id is not null and es.position is not null
  ),
  last_finished as (
    select distinct on (series_id) series_id, position, finished_on, work_id, title
      from her_places
     where status = 'finished'
     order by series_id, position desc
  ),
  candidates as (
    select lf.series_id, lf.position as finished_position, lf.finished_on, lf.work_id as finished_work,
           lf.title as finished_title, nxt.work_id, nxt.position
      from last_finished lf
      join lateral (
        select ws.work_id, ws.position
          from public.work_series ws
         where ws.series_id = lf.series_id
           and ws.position > lf.position
           and not exists (select 1 from her_places hp
                            where hp.series_id = lf.series_id and hp.position = ws.position and hp.status = 'finished')
         order by ws.position
         limit 1
      ) nxt on true
  ),
  -- A parent series is left out when one of its sub-series is a candidate too.
  specific as (
    select c.* from candidates c
     where not exists (select 1 from candidates o join public.series s on s.id = o.series_id
                        where s.parent_id = c.series_id)
  )
  select coalesce(jsonb_agg(item order by finished_on desc nulls last), '[]')
    from (
      select jsonb_build_object(
               'series', jsonb_strip_nulls(jsonb_build_object('id', s.id, 'name', s.name, 'parentId', s.parent_id)),
               'finished', jsonb_strip_nulls(jsonb_build_object(
                  'position', sp.finished_position, 'workId', sp.finished_work, 'title', sp.finished_title)),
               'next', public.work_card(w.id, p_language, sp.position)
             ) as item,
             sp.finished_on
        from specific sp
        join public.series s on s.id = sp.series_id
        join public.works w on w.id = sp.work_id
       order by sp.finished_on desc nulls last
       limit greatest(1, least(coalesce(p_limit, 5), 50))
    ) items
$function$
;
