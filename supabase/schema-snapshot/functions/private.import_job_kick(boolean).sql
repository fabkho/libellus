CREATE OR REPLACE FUNCTION private.import_job_kick(p_now boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings private.import_job_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.import_job_settings where id;
  if v_settings.function_url is null then return 'off'; end if;
  if not private.import_job_due() then return 'idle'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'import_job_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;

  update private.import_job_settings
     set last_kick_at = now()
   where id and (p_now or coalesce(last_kick_at, '-infinity') <= now() - min_interval);
  if not found then return 'debounced'; end if;

  -- pg_net sends after this transaction commits and waits in the background: as long as a chunk may run.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'run'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  update private.import_job_settings set last_request_id = v_request where id;
  return 'sent';
end
$function$
;
