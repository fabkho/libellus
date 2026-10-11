-- Home's "Next in your series", the series she has started (#167).
--
-- next_in_series() looked only at what she had finished. A series is started
-- as soon as she is reading one of its works, and what is still open in it is
-- the question Home answers, so this reads every work that is at least in
-- progress: currently reading, or finished. Want to read alone does not start a
-- series, nor does a work she gave up on (finished with an abandoned latest
-- read, "Not finished").
--
-- For each started series that still has a work she has neither finished,
-- is reading nor gave up on, one item: the series, how many she finished, how
-- many whole-numbered works it has (`count`, as series_works counts them: the
-- Catalogue's list, with her own corrections), when she last read in it, and the
-- next open work as a work_card (so its cover, title and her status of it, which
-- is Want to read or none, come with it). Most recent activity first: the latest
-- finish, or the day she started the work she is reading.
--
-- The next open work is the first one after the furthest she has started, else
-- (nothing is left after it) the first gap before. A series whose every known
-- work she has finished, is reading or gave up on is not listed: the Catalogue's
-- list is all there is to go on, so a total nobody knows never makes a series
-- unfinished.
--
-- Her own corrections count (her entry placed in a series at a position). When a
-- series and its parent both qualify only the sub-series is named (City Watch,
-- not Discworld). Invoker rights: her entries and sessions are RLS-bound to her,
-- so no other member's reading is ever seen. next_in_series stays for the
-- installed apps that still call it.
create function public.started_series(p_limit integer default 50, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  -- Each of her entries with where it stands: reading, finished, abandoned (finished,
  -- the latest read given up) or want_to_read, and the day it last moved.
  with ent as (
    select e.id as entry_id, e.book_id,
           case when e.status = 'finished' and (select ls.outcome from public.latest_session(e) ls) = 'abandoned'
                then 'abandoned' else e.status::text end as status,
           coalesce((select max(coalesce(s.ended_on, s.started_on)) from public.reading_sessions s
                      where s.entry_id = e.id and s.outcome is distinct from 'abandoned'),
                    (e.added_at at time zone 'utc')::date) as active_on
      from public.library_entries e
     where e.member_id = (select auth.uid())
  ),
  -- Her best entry per work: finished, reading, want to read, abandoned; the latest first.
  best as (
    select distinct on (bw.work_id) bw.work_id, ent.entry_id, ent.status, ent.active_on
      from ent
      join public.book_works bw on bw.book_id = ent.book_id
     order by bw.work_id,
              case ent.status when 'finished' then 0 when 'reading' then 1 when 'want_to_read' then 2 else 3 end,
              ent.active_on desc
  ),
  -- Every place she has an entry at in a series (a position may be missing), with its status.
  her_places as (
    select ws.series_id, ws.position, b.status, b.active_on, b.work_id
      from best b
      join public.work_series ws on ws.work_id = b.work_id
     where not exists (select 1 from public.entry_series es where es.entry_id = b.entry_id)
    union all
    select es.series_id, es.position, ent.status, ent.active_on,
           (select bw.work_id from public.book_works bw where bw.book_id = ent.book_id limit 1)
      from public.entry_series es
      join ent on ent.entry_id = es.entry_id
     where es.member_id = (select auth.uid()) and es.series_id is not null
  ),
  started as (
    select hp.series_id,
           max(hp.active_on) as active_on,
           max(hp.position) as furthest,
           count(*) filter (where hp.status = 'finished')::int as finished
      from her_places hp
     where hp.status in ('reading', 'finished')
     group by hp.series_id
  ),
  candidates as (
    select st.*, nxt.work_id, nxt.position
      from started st
      join lateral (
        select ws.work_id, ws.position
          from public.work_series ws
         where ws.series_id = st.series_id
           and ws.position is not null
           and not exists (select 1 from her_places hp
                            where hp.series_id = st.series_id
                              and hp.status in ('reading', 'finished', 'abandoned')
                              and (hp.work_id = ws.work_id or hp.position = ws.position))
         order by (ws.position > coalesce(st.furthest, -1)) desc, ws.position
         limit 1
      ) nxt on true
  ),
  -- A parent series is left out when one of its sub-series is a candidate too.
  specific as (
    select c.* from candidates c
     where not exists (select 1 from candidates o join public.series s on s.id = o.series_id
                        where s.parent_id = c.series_id)
  )
  select coalesce(jsonb_agg(item order by active_on desc nulls last, series_name), '[]')
    from (
      select jsonb_strip_nulls(jsonb_build_object(
               'series', jsonb_build_object('id', s.id, 'name', s.name, 'parentId', s.parent_id),
               'finished', sp.finished,
               -- "Book 3 of 10": the whole-numbered positions the series has.
               'count', nullif((select count(distinct p.position)
                                  from (select ws.position from public.work_series ws where ws.series_id = s.id
                                        union all
                                        select hp.position from her_places hp where hp.series_id = s.id) p
                                 where p.position is not null and p.position = trunc(p.position)), 0),
               'activeOn', sp.active_on,
               'next', public.work_card(w.id, p_language, sp.position)
             )) as item,
             sp.active_on,
             s.name as series_name
        from specific sp
        join public.series s on s.id = sp.series_id
        join public.works w on w.id = sp.work_id
       order by sp.active_on desc nulls last, s.name
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) items
$$;

comment on function public.started_series(integer, text) is
  'Issue #167: Home''s "Next in your series" — per series she has started (a work currently reading '
  'or finished; want to read or abandoned alone do not count) that still has a work open, the next '
  'open work, most recent activity first.';

revoke all on function public.started_series(integer, text) from public, anon;
grant execute on function public.started_series(integer, text) to authenticated, service_role;
