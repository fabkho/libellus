CREATE OR REPLACE FUNCTION private.shelf_publish_send(p_token text, p_repository text, p_event_type text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request bigint;
begin
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 10000)'
    into v_request
    using format('https://api.github.com/repos/%s/dispatches', p_repository),
          jsonb_build_object('event_type', p_event_type,
                             'client_payload', jsonb_build_object('source', 'libellus', 'at', now())),
          jsonb_build_object('Authorization', 'Bearer ' || p_token,
                             'Accept', 'application/vnd.github+json',
                             'X-GitHub-Api-Version', '2022-11-28',
                             'User-Agent', 'libellus-shelf-publish',
                             'Content-Type', 'application/json');
  return v_request;
end;
$function$
;
