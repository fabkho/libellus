-- Home's two series lists from one evaluation of the chain (perf assessment F5,
-- docs/perf/backend.md).
--
-- A member with mutes still paid for the chain twice per Home: started_series and
-- muted_series_list are two requests, and each ran started_series_items (her entries,
-- sessions, work_series, a lateral NOT EXISTS per candidate series) before its own
-- muted filter (#238 only made the second one free for a member without mutes). Two
-- requests cannot share one evaluation, so there is one function that answers both:
--
--   started_and_muted_series(p_limit, p_language) -> {"open": [...], "muted": [...]}
--
-- "open" is what started_series returns and "muted" what muted_series_list returns,
-- item for item, each cut at p_limit. The chain, written once, now lives in
-- started_series_core; it ends in the split on "muted" or not (muting a series decides
-- after the parent/sub-series rule, as before) and builds the items for the sides asked
-- for. started_series_items (the helper both existing functions call) is a thin
-- wrapper over it, so started_series and muted_series_list keep their signature, their
-- JSON (an array of items, '[]' when there are none) and their items; neither is
-- touched. Installed apps keep calling them; the new client calls the new function.
--
-- Invoker rights, as for the helper: her entries, sessions and mutes stay RLS-bound to
-- her; the visibility rules in the chain (library_entries and entry_series filtered by
-- member_id = auth.uid(), muted_series by member_id = auth.uid()) are word for word the
-- ones of started_series_items. No policy changes.

create function public.started_series_core(p_limit integer, p_language text, p_open boolean, p_muted boolean)
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
  ),
  -- Muted or not is decided after that: muting City Watch does not bring Discworld back.
  -- Only the sides asked for go on, each ranked on its own so p_limit cuts each one.
  ranked as (
    select sp.*, m.is_muted, s.name as series_name, s.parent_id,
           row_number() over (partition by m.is_muted order by sp.active_on desc nulls last, s.name) as rn
      from specific sp
      cross join lateral (
        select exists (select 1 from public.muted_series ms
                        where ms.member_id = (select auth.uid()) and ms.series_id = sp.series_id) as is_muted
      ) m
      join public.series s on s.id = sp.series_id
      join public.works w on w.id = sp.work_id
     where (case when m.is_muted then p_muted else p_open end)
  ),
  items as (
    select r.is_muted, r.active_on, r.series_name,
           jsonb_strip_nulls(jsonb_build_object(
             'series', jsonb_build_object('id', r.series_id, 'name', r.series_name, 'parentId', r.parent_id),
             'finished', r.finished,
             -- "Book 3 of 10": the whole-numbered positions the series has.
             'count', nullif((select count(distinct p.position)
                                from (select ws.position from public.work_series ws where ws.series_id = r.series_id
                                      union all
                                      select hp.position from her_places hp where hp.series_id = r.series_id) p
                               where p.position is not null and p.position = trunc(p.position)), 0),
             'activeOn', r.active_on,
             'next', public.work_card(r.work_id, p_language, r.position)
           )) as item
      from ranked r
     where r.rn <= greatest(1, least(coalesce(p_limit, 50), 200))
  )
  select jsonb_build_object(
    'open',  coalesce((select jsonb_agg(i.item order by i.active_on desc nulls last, i.series_name)
                         from items i where not i.is_muted), '[]'),
    'muted', coalesce((select jsonb_agg(i.item order by i.active_on desc nulls last, i.series_name)
                         from items i where i.is_muted), '[]')
  )
$$;

comment on function public.started_series_core(integer, text, boolean, boolean) is
  'Issue #167, perf F5: the chain behind started_series, muted_series_list and started_and_muted_series, '
  'evaluated once: {"open": [...], "muted": [...]}, a side left empty when not asked for.';

revoke all on function public.started_series_core(integer, text, boolean, boolean) from public, anon;
grant execute on function public.started_series_core(integer, text, boolean, boolean) to authenticated, service_role;

-- The helper the two existing functions call keeps its signature and its answer: one side
-- of the core, as the array it always was.
create or replace function public.started_series_items(p_limit integer, p_language text, p_muted boolean)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.started_series_core(p_limit, p_language, not p_muted, p_muted)
         -> (case when p_muted then 'muted' else 'open' end)
$$;

-- Home's two lists in one call.
create function public.started_and_muted_series(p_limit integer default 50, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.started_series_core(p_limit, p_language, true, true)
$$;

comment on function public.started_and_muted_series(integer, text) is
  'Issue #167, perf F5: {"open": started_series(...), "muted": muted_series_list(...)} from one evaluation '
  'of the chain: Home''s "Next in your series" and its Muted list in one request.';

revoke all on function public.started_and_muted_series(integer, text) from public, anon;
grant execute on function public.started_and_muted_series(integer, text) to authenticated, service_role;
