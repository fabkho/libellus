CREATE OR REPLACE FUNCTION private.shelf_publish_dispatch()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_settings private.shelf_publish;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.shelf_publish where id;
  if v_settings.owner_id is null then
    return 'off';
  end if;
  if v_settings.last_changed_at is null
     or v_settings.last_changed_at <= v_settings.last_dispatched_at then
    return 'up_to_date';
  end if;
  if v_settings.last_dispatched_at > now() - v_settings.min_interval then
    return 'debounced';
  end if;

  v_token := private.shelf_publish_token();
  if v_token is null then
    return 'unavailable';
  end if;

  update private.shelf_publish
     set last_dispatched_at = now()
   where id
     and last_changed_at > coalesce(last_dispatched_at, '-infinity')
     and coalesce(last_dispatched_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  v_request := private.shelf_publish_send(v_token, v_settings.repository, v_settings.event_type);
  update private.shelf_publish set last_request_id = v_request where id;
  return 'dispatched';
end;
$function$
;
