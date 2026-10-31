CREATE OR REPLACE FUNCTION private.cover_store_tick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce((select enabled from private.cover_store_settings where id), false) then return 'off'; end if;
  update private.cover_store_queue
     set state = 'queued', attempts = 5
   where state = 'failed' and due_at <= now();
  perform private.cover_store_reconcile();
  return private.cover_store_kick(false);
end
$function$
;
