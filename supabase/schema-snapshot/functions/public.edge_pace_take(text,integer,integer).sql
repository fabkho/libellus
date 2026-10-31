CREATE OR REPLACE FUNCTION public.edge_pace_take(p_bucket text, p_gap_ms integer, p_max_wait_ms integer)
 RETURNS TABLE(granted boolean, wait_ms integer)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
