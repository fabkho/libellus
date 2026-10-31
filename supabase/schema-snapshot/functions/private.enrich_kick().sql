CREATE OR REPLACE FUNCTION private.enrich_kick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings private.enrich_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.enrich_settings where id;
  if v_settings.function_url is null then
    return 'off';
  end if;
  if not exists (select 1 from private.enrich_queue
                  where not_before <= now() and (claimed_until is null or claimed_until < now())) then
    return 'idle';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'enrich_token';
  if nullif(btrim(v_token), '') is null then
    return 'unavailable';
  end if;

  update private.enrich_settings
     set last_kick_at = now()
   where id and coalesce(last_kick_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  -- pg_net waits in the background, never in this transaction: long enough for a whole drain.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'drain'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token),
                             'Content-Type', 'application/json');
  update private.enrich_settings set last_request_id = v_request where id;
  return 'sent';
end;
$function$
;
