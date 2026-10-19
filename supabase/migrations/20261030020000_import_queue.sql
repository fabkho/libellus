-- The import queue: one member's import does its lookups at a time, across all members (owner decision
-- 19 Oct 2026: "there's no benefit of doing multiple imports at the same time when the requests would
-- start timing out").
--
--   public.import_queue         one row per member in line (her primary key: she cannot hold two
--                               places); `started_at` is set on the one that has the slot, and a
--                               partial unique index lets at most one row have it
--   import_slot_take(holder, rows)   takes the slot, or a place in the line
--   import_slot_beat(holder, done)   the heartbeat of the one running, and the poll of the ones
--                                    waiting; also tells whether the place was lost
--   import_slot_leave(holder)        gives the slot or the place up
--
-- All three answer (state, mine, ahead, rows_ahead):
--   state      'running' (the slot is hers), 'waiting' (in line), 'none' (not in line: never
--              taken, left, or the place expired)
--   mine       the row belongs to the `holder` asking. A member's second device is another
--              holder: it gets her row back with mine = false (her import is running or waiting
--              on the other device) and does not start a second one, beat does not refresh it and
--              leave does not end it.
--   ahead      imports before hers (the running one included); 0 while the slot is hers
--   rows_ahead books those imports still have to look up (rows - done), for a rough wait
--
-- A place whose last beat is older than 75 seconds is gone (the app was closed, the phone went to
-- sleep, a crash): every call sweeps those first, and the next in line (oldest first) takes the
-- slot at once. The running import beats every 15 s, a waiting one polls every 5 s.
--
-- `holder` is whoever runs the import: a device ('device:<uuid>' today). The planned server job
-- (proposal #329) takes the slot with its own holder ('job:<id>') in this same table, so a device
-- import and a job queue behind each other.
--
-- Refusals: not_signed_in (42501), holder_invalid / rows_invalid (22023).
-- Deleted with the member: the row cascades from auth.users.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.import_queue (
  member_id  uuid primary key references auth.users (id) on delete cascade,
  holder     text not null check (char_length(holder) between 1 and 64),
  -- Books to look up, and how many are done: what those behind her can expect to wait.
  rows       integer not null default 0 check (rows between 0 and 100000),
  done       integer not null default 0 check (done >= 0),
  joined_at  timestamptz not null default clock_timestamp(),
  -- Null while waiting; set on the one that has the slot.
  started_at timestamptz,
  beat_at    timestamptz not null default clock_timestamp()
);

-- At most one row has the slot, whatever the functions do.
create unique index import_queue_one_runner on public.import_queue ((true)) where started_at is not null;
create index import_queue_line on public.import_queue (joined_at, member_id) where started_at is null;

comment on table public.import_queue is
  'The import queue: the member whose import does its lookups (started_at set) and those waiting, oldest first. '
  'Read and written only through import_slot_take / import_slot_beat / import_slot_leave.';

alter table public.import_queue enable row level security;
revoke all on public.import_queue from public, anon, authenticated;
grant select, insert, update, delete on public.import_queue to service_role;

-- How long a place lives without a beat.
create function private.import_slot_ttl()
returns interval
language sql
immutable
set search_path = pg_catalog
as $$ select interval '75 seconds' $$;

-- Under the queue's lock: drops the places whose beat stopped and gives the slot to the oldest
-- waiting one when nobody has it.
create function private.import_slot_sweep()
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  delete from public.import_queue where beat_at < clock_timestamp() - private.import_slot_ttl();
  if not exists (select 1 from public.import_queue where started_at is not null) then
    update public.import_queue
       set started_at = clock_timestamp()
     where member_id = (
       select q.member_id from public.import_queue q order by q.joined_at, q.member_id limit 1
     );
  end if;
end
$$;

-- What the caller is told: her row and where she stands.
create function private.import_slot_state(p_member uuid, p_holder text)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language sql
stable
set search_path = pg_catalog, public
as $$
  with me as (select * from public.import_queue where member_id = p_member),
  line as (
    select q.member_id,
           row_number() over (order by (q.started_at is null), q.joined_at, q.member_id) - 1 as ahead,
           q.rows - least(q.done, q.rows) as left_to_do
      from public.import_queue q
  )
  select case when me.member_id is null then 'none' when me.started_at is not null then 'running' else 'waiting' end,
         coalesce(me.holder = p_holder, false),
         coalesce((select l.ahead from line l where l.member_id = p_member), 0)::integer,
         coalesce((select sum(l.left_to_do) from line l where l.ahead < (select l2.ahead from line l2 where l2.member_id = p_member)), 0)::integer
    from (select 1) one left join me on true
$$;

create function public.import_slot_take(p_holder text, p_rows integer default 0)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  if p_rows is null or p_rows not between 0 and 100000 then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  -- Her one place: the same device asking again keeps it (and its turn); another of her devices is told it is taken.
  insert into public.import_queue as q (member_id, holder, rows)
  values (v_member, p_holder, p_rows)
  on conflict (member_id) do update
    set rows = excluded.rows, beat_at = clock_timestamp()
    where q.holder = excluded.holder;
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

create function public.import_slot_beat(p_holder text, p_done integer default null)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  -- Her own beat counts before the sweep: a beat that comes late but before anyone swept keeps the place.
  update public.import_queue
     set beat_at = clock_timestamp(), done = greatest(done, least(coalesce(p_done, done), rows))
   where member_id = v_member and holder = p_holder;
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

create function public.import_slot_leave(p_holder text)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  delete from public.import_queue where member_id = v_member and holder = p_holder;
  -- The slot goes on to the next in line at once, not at the next caller's sweep.
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

revoke all on function private.import_slot_ttl() from public, anon, authenticated;
revoke all on function private.import_slot_sweep() from public, anon, authenticated;
revoke all on function private.import_slot_state(uuid, text) from public, anon, authenticated;
revoke all on function public.import_slot_take(text, integer) from public, anon;
revoke all on function public.import_slot_beat(text, integer) from public, anon;
revoke all on function public.import_slot_leave(text) from public, anon;
grant execute on function public.import_slot_take(text, integer) to authenticated;
grant execute on function public.import_slot_beat(text, integer) to authenticated;
grant execute on function public.import_slot_leave(text) to authenticated;
