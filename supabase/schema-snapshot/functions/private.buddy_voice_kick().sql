CREATE OR REPLACE FUNCTION private.buddy_voice_kick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_url     text;
  v_token   text;
  v_request bigint;
begin
  select function_url into v_url from private.buddy_voice_settings where id;
  if v_url is null then return 'off'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'buddy_voice_sweep_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
    into v_request
    using v_url, '{}'::jsonb,
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  return 'sent';
exception when others then
  raise warning 'buddy-voice sweep not requested: %', sqlerrm;
  return 'unavailable';
end;
$function$
;
