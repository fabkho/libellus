CREATE OR REPLACE FUNCTION private.cover_gc_kick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings private.cover_store_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.cover_store_settings where id;
  if not coalesce(v_settings.enabled, false) or v_settings.function_url is null then return 'off'; end if;
  if not private.cover_gc_due() then return 'idle'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'cover_store_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;

  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'gc'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  return 'sent';
end
$function$
;
