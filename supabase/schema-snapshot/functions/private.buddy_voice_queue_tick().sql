CREATE OR REPLACE FUNCTION private.buddy_voice_queue_tick()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
  select case when exists (select 1 from private.buddy_voice_trash t
                            where t.attempts < 20
                              and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes'))
              then private.buddy_voice_kick(true, false)
              else 'idle' end
$function$
;
