CREATE OR REPLACE FUNCTION public.edge_rate_hit(p_member uuid, p_bucket text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with hit as (
    insert into public.edge_rate_limits as r (member_id, bucket, window_start, hits)
    values (p_member, p_bucket, now(), 1)
    on conflict (member_id, bucket) do update
      set window_start = case
            when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
            else r.window_start
          end,
          hits = case
            when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
            else r.hits + 1
          end
    returning r.hits
  )
  select hits <= p_limit from hit
$function$
;
