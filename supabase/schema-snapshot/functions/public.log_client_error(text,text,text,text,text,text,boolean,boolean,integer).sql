CREATE OR REPLACE FUNCTION public.log_client_error(p_kind text, p_message text, p_stack text DEFAULT NULL::text, p_route text DEFAULT NULL::text, p_app_version text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_standalone boolean DEFAULT NULL::boolean, p_online boolean DEFAULT NULL::boolean, p_count integer DEFAULT 1)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_member  uuid := auth.uid();
  v_headers jsonb;
  v_address text;
  v_caller  text;
  v_message text;
  v_stack   text;
  v_route   text;
  v_count   integer := least(greatest(coalesce(p_count, 1), 1), 1000);
  v_row     bigint;
  v_recent  bigint;
  -- Rows a caller may add in an hour: a member, one signed-out address.
  v_limit   integer := 30;
begin
  if p_kind is null or p_kind not in ('error', 'unhandledrejection', 'vue', 'chunk', 'outbox', 'shelf', 'vitals') then
    raise exception 'kind_invalid' using errcode = '22023';
  end if;

  v_message := left(private.scrub_client_text(btrim(left(coalesce(p_message, ''), 4000))), 1000);
  if v_message = '' then
    raise exception 'message_missing' using errcode = '22023';
  end if;
  v_stack := nullif(left(private.scrub_client_text(left(p_stack, 32000)), 8000), '');
  -- The path only: no query, no fragment, nothing that is not a path.
  v_route := left(split_part(split_part(btrim(p_route), '?', 1), '#', 1), 200);
  if v_route !~ '^/' then
    v_route := null;
  end if;

  if v_member is not null then
    v_caller := 'member:' || v_member;
  else
    v_limit := 10;
    -- PostgREST hands the request's headers over as a setting. The first address
    -- of x-forwarded-for is the client's, as the platform's proxy saw it.
    v_headers := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
    v_address := coalesce(
      nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
      nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
      nullif(btrim(v_headers ->> 'x-real-ip'), ''),
      'unknown');
    v_caller := 'anon:' || left(encode(sha256(convert_to(
      v_address || (select salt from private.client_error_salt), 'UTF8')), 'hex'), 32);
  end if;

  -- One report of a caller at a time, so two at once cannot both slip under a limit or both make the row.
  perform pg_advisory_xact_lock(hashtext('log_client_error:' || v_caller));

  -- The same error again shortly after: counted on its row.
  update private.client_errors e
     set count = least(e.count::bigint + v_count, 2147483647)::integer,
         last_seen_at = now()
   where e.id = (
     select c.id from private.client_errors c
      where c.caller_key = v_caller
        and c.created_at > now() - interval '10 minutes'
        and c.kind = p_kind
        and c.message = v_message
        and c.stack is not distinct from v_stack
      order by c.created_at desc
      limit 1)
  returning e.id into v_row;
  if v_row is not null then
    return 'counted';
  end if;

  select count(*) into v_recent from private.client_errors c
   where c.caller_key = v_caller and c.created_at > now() - interval '1 hour';
  if v_recent >= v_limit then
    return 'dropped';
  end if;
  if v_member is null then
    perform pg_advisory_xact_lock(hashtext('log_client_error:anon'));
    select count(*) into v_recent from private.client_errors c
     where c.user_id is null and c.caller_key like 'anon:%' and c.created_at > now() - interval '1 hour';
    if v_recent >= 100 then
      return 'dropped';
    end if;
  end if;

  insert into private.client_errors
    (user_id, caller_key, kind, message, stack, route, app_version, user_agent, standalone, online, count)
  values
    (v_member, v_caller, p_kind, v_message, v_stack, v_route,
     nullif(left(btrim(p_app_version), 64), ''), nullif(left(btrim(p_user_agent), 200), ''),
     p_standalone, p_online, v_count);
  return 'logged';
end;
$function$
;
