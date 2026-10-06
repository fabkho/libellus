-- The instance's owner reads the client error log in the app.
--
-- The log (20261006073000_client_errors.sql) is read in the Supabase dashboard.
-- This lets the owner, and only the owner, read it from the Profile as well:
--
--   private.instance_owner               one row: whose instance this is (empty = nobody's)
--   private.is_instance_owner()          whether the signed-in member is that one
--   owner_client_errors(p_days)          the last days' errors, grouped by kind and message
--   owner_client_error_detail(p_hash)    the latest report of one group, stack and all
--
-- Who the owner is lives in one row, set once by SQL, empty here (no address in
-- SQL), like private.shelf_publish:
--
--   update private.instance_owner
--      set owner_id = (select id from auth.users where email = '<owner>');
--
-- It is its own row and not shelf_publish.owner_id on purpose: that column says
-- whose Library changes publish the Regal shelf (an instance may well switch the
-- shelf off, null, and still have an owner), and which of the two a change of
-- one should move is not for a trigger to guess. On the owner's instance both
-- name the same person.
--
-- The check is here, not only in the app: both functions raise `not_owner`
-- (42501) for anyone but that member (any other member, a signed-out caller,
-- and everyone while the row is empty) and are not granted to `anon` at all.
-- The rows come out grouped and never carry another member's id: only how many
-- members an error touched.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.instance_owner (
  -- One row: `id` can only be true.
  id       boolean primary key default true check (id),
  -- The auth user who owns this instance; null = nobody (the owner's screens are off).
  owner_id uuid references auth.users (id) on delete set null
);

comment on table private.instance_owner is
  'Whose instance this is: the one member who reads the client error log in the app. One row, empty until set by SQL '
  '(docs/SELF_HOSTING.md, The owner). Not private.shelf_publish.owner_id, which is only about the Regal shelf.';

insert into private.instance_owner default values;

alter table private.instance_owner enable row level security;
revoke all on private.instance_owner from public, anon, authenticated;

-- The signed-in member is the owner. False for a signed-out caller and while nobody is named.
create function private.is_instance_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select o.owner_id = (select auth.uid()) from private.instance_owner o),
    false)
$$;

revoke all on function private.is_instance_owner() from public, anon, authenticated;

-- ----------------------------------------------------------------- the groups

-- What one error is, across rows: its kind and message, as a stable key the app can ask for again.
create function private.client_error_hash(p_kind text, p_message text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select md5(p_kind || chr(10) || p_message)
$$;

revoke all on function private.client_error_hash(text, text) from public, anon, authenticated;

create function public.owner_client_errors(p_days integer default 7)
returns table (
  message_hash    text,
  kind            text,
  message         text,
  times           bigint,
  first_seen      timestamptz,
  last_seen       timestamptz,
  app_versions    text[],
  routes          text[],
  standalone_times bigint,
  browser_times   bigint,
  online_times    bigint,
  offline_times   bigint,
  members         bigint,
  signed_out_times bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  -- The log keeps 30 days (purge_client_errors).
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_since timestamptz;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  v_since := now() - make_interval(days => v_days);

  -- The groups with a report in the window; what each is counted over is that window,
  -- but `first_seen` is the first time ever (within what is kept), so an old error that
  -- came back is not mistaken for a new one.
  return query
    with firsts as (
      select c.kind, c.message, min(c.created_at) as first_seen
        from private.client_errors c
       group by c.kind, c.message
    )
    select private.client_error_hash(c.kind, c.message),
           c.kind,
           c.message,
           sum(c.count)::bigint,
           f.first_seen,
           max(c.last_seen_at),
           coalesce(array_agg(distinct c.app_version) filter (where c.app_version is not null), '{}'),
           coalesce((array_agg(distinct c.route) filter (where c.route is not null))[1:10], '{}'),
           coalesce(sum(c.count) filter (where c.standalone is true), 0)::bigint,
           coalesce(sum(c.count) filter (where c.standalone is false), 0)::bigint,
           coalesce(sum(c.count) filter (where c.online is true), 0)::bigint,
           coalesce(sum(c.count) filter (where c.online is false), 0)::bigint,
           count(distinct c.user_id),
           coalesce(sum(c.count) filter (where c.user_id is null), 0)::bigint
      from private.client_errors c
      join firsts f on f.kind = c.kind and f.message = c.message
     where c.last_seen_at > v_since
     group by c.kind, c.message, f.first_seen
     order by max(c.last_seen_at) desc
     limit 200;
end;
$$;

comment on function public.owner_client_errors(integer) is
  'The instance owner''s view of the client error log: the last p_days days (1 to 30, default 7) grouped by kind and '
  'message, newest first, at most 200: how often, first and last seen, the builds and routes, installed vs in a tab, '
  'online vs offline, and how many members it touched (never who). Raises not_owner for anyone else.';

revoke all on function public.owner_client_errors(integer) from public, anon;
grant execute on function public.owner_client_errors(integer) to authenticated;

-- ------------------------------------------------------------ one group's stack

create function public.owner_client_error_detail(p_message_hash text)
returns table (
  kind        text,
  message     text,
  stack       text,
  route       text,
  app_version text,
  user_agent  text,
  standalone  boolean,
  online      boolean,
  reported_at timestamptz,
  last_seen   timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- The newest report of the group (its message hash, as owner_client_errors gave it).
  return query
    select c.kind, c.message, c.stack, c.route, c.app_version, c.user_agent, c.standalone, c.online,
           c.created_at, c.last_seen_at
      from private.client_errors c
     where private.client_error_hash(c.kind, c.message) = p_message_hash
     order by c.last_seen_at desc, c.id desc
     limit 1;
end;
$$;

comment on function public.owner_client_error_detail(text) is
  'The newest report of one error group (the message_hash owner_client_errors gave): its stack, route, build and device. '
  'No row when the group is gone. Raises not_owner for anyone but the instance owner.';

revoke all on function public.owner_client_error_detail(text) from public, anon;
grant execute on function public.owner_client_error_detail(text) to authenticated;
