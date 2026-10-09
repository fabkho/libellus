-- Mute a started series (Home's "Next in your series").
--
-- A series she has started but does not plan to continue (she finished The Word
-- for World Is Forest, Hainish Cycle #6; Home keeps offering #8) can be muted:
-- the whole series, never single books. A muted series leaves started_series and
-- is listed by muted_series_list, so she can still find it and unmute it. It
-- stays muted when she reads another work of it: the mute belongs to the series,
-- not to what was open when she pressed it.
--
-- Shape: started_series keeps its signature and its JSON (an array of items), so
-- installed apps that call it only stop seeing what is muted. The muted ones come
-- from a second function, muted_series_list, with the same item shape, rather than
-- a sibling key in started_series: a key would change the array to an object and
-- break every installed client.
--
-- A muted series that no longer qualifies (every work finished, or read/given up,
-- or nothing she reads in it any more) is not in the muted list either: the list
-- is the series Home would be offering, hidden. It reappears there if it qualifies
-- again. The row in muted_series stays either way.
--
-- Muting is online only, like her series corrections: two functions, no
-- sync_write action. Written through mute_series / unmute_series only; the table
-- is read by its owner (RLS) and granted no direct write.

create table public.muted_series (
  member_id  uuid not null references auth.users on delete cascade,
  series_id  uuid not null references public.series on delete cascade,
  muted_at   timestamptz not null default now(),
  primary key (member_id, series_id)
);

comment on table public.muted_series is
  'Issue #167: a series the member muted on Home ("Next in your series"). Written through mute_series / unmute_series.';

create index muted_series_series on public.muted_series (series_id);

alter table public.muted_series enable row level security;

revoke all on public.muted_series from anon, authenticated;
grant select on public.muted_series to authenticated;
grant select, insert, update, delete on public.muted_series to service_role;

create policy muted_series_own on public.muted_series
  for select to authenticated
  using (member_id = (select auth.uid()));

-- Mute one series she can see. Idempotent: muting a muted series changes nothing.
create function public.mute_series(p_series uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.series s
                  where s.id = p_series and (s.created_by is null or s.created_by = v_member)) then
    raise exception 'series_not_found' using errcode = 'P0002';
  end if;
  insert into public.muted_series (member_id, series_id)
  values (v_member, p_series)
  on conflict do nothing;
end;
$$;

-- Unmute it. Idempotent: a series that is not muted stays as it is.
create function public.unmute_series(p_series uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.series s
                  where s.id = p_series and (s.created_by is null or s.created_by = v_member)) then
    raise exception 'series_not_found' using errcode = 'P0002';
  end if;
  delete from public.muted_series where member_id = v_member and series_id = p_series;
end;
$$;

revoke all on function public.mute_series(uuid) from public, anon;
revoke all on function public.unmute_series(uuid) from public, anon;
grant execute on function public.mute_series(uuid) to authenticated;
grant execute on function public.unmute_series(uuid) to authenticated;

-- The list behind started_series (see 20261014010000_started_series.sql for the
-- rule), for the muted or the not muted ones. Invoker rights: her entries, sessions
-- and mutes are RLS-bound to her. Called by the two functions below, not by the app.
create function public.started_series_items(p_limit integer, p_language text, p_muted boolean)
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
  wanted as (
    select sp.* from specific sp
     where exists (select 1 from public.muted_series ms
                    where ms.member_id = (select auth.uid()) and ms.series_id = sp.series_id) = p_muted
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
        from wanted sp
        join public.series s on s.id = sp.series_id
        join public.works w on w.id = sp.work_id
       order by sp.active_on desc nulls last, s.name
       limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) items
$$;

comment on function public.started_series_items(integer, text, boolean) is
  'Issue #167: the items behind started_series (p_muted false) and muted_series_list (p_muted true).';

revoke all on function public.started_series_items(integer, text, boolean) from public, anon;
grant execute on function public.started_series_items(integer, text, boolean) to authenticated, service_role;

-- Same signature, same JSON as before: only what she muted is left out.
create or replace function public.started_series(p_limit integer default 50, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.started_series_items(p_limit, p_language, false)
$$;

-- What she muted and Home would otherwise offer: the same items, most recent activity first.
create function public.muted_series_list(p_limit integer default 50, p_language text default 'en')
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select public.started_series_items(p_limit, p_language, true)
$$;

comment on function public.started_series(integer, text) is
  'Issue #167: Home''s "Next in your series" — per series she has started (a work currently reading '
  'or finished; want to read or abandoned alone do not count) that still has a work open and that she '
  'did not mute, the next open work, most recent activity first.';
comment on function public.muted_series_list(integer, text) is
  'Issue #167: the series she muted that started_series would otherwise list, same items.';

revoke all on function public.muted_series_list(integer, text) from public, anon;
grant execute on function public.muted_series_list(integer, text) to authenticated, service_role;
