CREATE OR REPLACE FUNCTION public.owner_client_error_detail(p_message_hash text)
 RETURNS TABLE(kind text, message text, stack text, route text, app_version text, user_agent text, standalone boolean, online boolean, reported_at timestamp with time zone, last_seen timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
