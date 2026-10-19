-- One pace for an upstream that counts requests per address (Open Library: 3 a second identified;
-- the German National Library: 5 a second). Supabase runs more than one instance of an edge function
-- under load, and each kept its own queue, so N instances asked N times as fast from one address.
-- Now every instance takes its turn here first.
--
--   public.edge_pace            one row per upstream: the moment its next request may go out
--   edge_pace_take(bucket, gap_ms, max_wait_ms)
--                               books the next free turn: granted with the milliseconds to wait
--                               (the caller sleeps that long, then asks), or refused when the
--                               wait would be longer than max_wait_ms (then wait_ms is how long
--                               until a turn would be within it: the caller answers "busy, retry
--                               after that"). Nothing is booked for a refusal.
--   edge_pace_hold(bucket, ms)  the upstream asked for a pause (Retry-After): no turn before then
--
-- Service role only. The row is locked for the length of one statement, so concurrent instances
-- are served one by one and the turns are `gap_ms` apart however many ask. Refusal: pace_invalid (22023).
-- Used by supabase/functions/_shared/pace.ts (the openlibrary and dnb-lookup functions).

create table public.edge_pace (
  bucket  text primary key,
  next_at timestamptz not null,
  constraint edge_pace_bucket_format check (bucket ~ '^[a-z][a-z-]{0,39}$')
);

comment on table public.edge_pace is
  'The moment the next request to an upstream with a request limit may go out (see edge_pace_take). Service role only.';

alter table public.edge_pace enable row level security;
revoke all on public.edge_pace from public, anon, authenticated;
grant select, insert, update, delete on public.edge_pace to service_role;

create function public.edge_pace_take(p_bucket text, p_gap_ms integer, p_max_wait_ms integer)
returns table (granted boolean, wait_ms integer)
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_next timestamptz;
  v_now  timestamptz;
  v_slot timestamptz;
  v_wait integer;
begin
  if p_gap_ms is null or p_gap_ms not between 1 and 60000
     or p_max_wait_ms is null or p_max_wait_ms not between 0 and 60000 then
    raise exception 'pace_invalid' using errcode = '22023';
  end if;
  insert into public.edge_pace (bucket, next_at) values (p_bucket, clock_timestamp()) on conflict do nothing;
  -- The row lock serves concurrent callers one by one. `clock_timestamp`, not `now`: a caller that
  -- waited for the lock must not read the time its statement started.
  select next_at into v_next from public.edge_pace where bucket = p_bucket for update;
  v_now := clock_timestamp();
  v_slot := greatest(v_next, v_now);
  v_wait := ceil(extract(epoch from (v_slot - v_now)) * 1000)::integer;
  if v_wait > p_max_wait_ms then
    -- Nothing is booked: the caller comes back when a turn is within its patience.
    return query select false, v_wait - p_max_wait_ms;
    return;
  end if;
  update public.edge_pace set next_at = v_slot + make_interval(secs => p_gap_ms / 1000.0) where bucket = p_bucket;
  return query select true, v_wait;
end
$$;

create function public.edge_pace_hold(p_bucket text, p_ms integer)
returns void
language sql
volatile
set search_path = pg_catalog, public
as $$
  insert into public.edge_pace as p (bucket, next_at)
  values (p_bucket, clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_ms, 0), 0), 60000) / 1000.0))
  on conflict (bucket) do update
    set next_at = greatest(p.next_at, excluded.next_at)
$$;

revoke all on function public.edge_pace_take(text, integer, integer) from public, anon, authenticated;
revoke all on function public.edge_pace_hold(text, integer) from public, anon, authenticated;
grant execute on function public.edge_pace_take(text, integer, integer) to service_role;
grant execute on function public.edge_pace_hold(text, integer) to service_role;
