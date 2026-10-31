CREATE OR REPLACE FUNCTION public.edge_pace_hold(p_bucket text, p_ms integer)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  insert into public.edge_pace as p (bucket, next_at)
  values (p_bucket, clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_ms, 0), 0), 60000) / 1000.0))
  on conflict (bucket) do update
    set next_at = greatest(p.next_at, excluded.next_at)
$function$
;
