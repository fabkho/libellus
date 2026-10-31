CREATE OR REPLACE FUNCTION public.owner_client_errors(p_days integer DEFAULT 7)
 RETURNS TABLE(message_hash text, kind text, message text, times bigint, first_seen timestamp with time zone, last_seen timestamp with time zone, app_versions text[], routes text[], standalone_times bigint, browser_times bigint, online_times bigint, offline_times bigint, members bigint, signed_out_times bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
