CREATE OR REPLACE FUNCTION private.catalogue_check_kick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings private.catalogue_check_settings;
  v_token text;
  v_request bigint;
  v_seen boolean;
  v_status integer;
  v_error text;
begin
  select * into v_settings from private.catalogue_check_settings where id;
  if v_settings.function_url is null then
    return 'off';
  end if;

  -- What the last call answered, once pg_net has it (it keeps responses for hours): a call that fails
  -- (a 401 for a wrong token, a 5xx, a timeout, no route) would otherwise leave the Books unchecked
  -- without a word. Read before anything else, so an idle or debounced kick records it too.
  if v_settings.last_request_id is not null and to_regclass('net._http_response') is not null then
    execute 'select true, status_code, case when status_code between 200 and 299 and error_msg is null then null '
            'else left(coalesce(error_msg, content), 500) end '
            'from net._http_response where id = $1'
      into v_seen, v_status, v_error using v_settings.last_request_id;
    if v_seen then
      update private.catalogue_check_settings
         set last_status = v_status, last_error = v_error, last_status_at = now()
       where id;
    end if;
  end if;
  if not private.catalogue_check_due() then
    return 'idle';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'catalogue_check_token';
  if nullif(btrim(v_token), '') is null then
    return 'unavailable';
  end if;

  update private.catalogue_check_settings
     set last_kick_at = now()
   where id and coalesce(last_kick_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  -- pg_net waits in the background, never in this transaction.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'drain'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token),
                             'Content-Type', 'application/json');
  update private.catalogue_check_settings set last_request_id = v_request where id;
  return 'sent';
end;
$function$
;
