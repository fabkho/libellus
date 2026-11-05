CREATE OR REPLACE FUNCTION private.buddy_voice_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  insert into private.buddy_voice_trash (path)
  values (private.buddy_voice_path(old.buddy_read_id, old.author_id, old.client_id, old.voice_mime))
  on conflict do nothing;
  if coalesce(current_setting('buddy_voice.kicked', true), '') <> 'on' then
    perform set_config('buddy_voice.kicked', 'on', true);
    perform private.buddy_voice_kick();
  end if;
  return null;
exception when others then
  -- Never costs the delete or the account its success; the hourly job finds the object by the sweep's second rule.
  raise warning 'buddy-voice: object of message % not queued: %', old.id, sqlerrm;
  return null;
end;
$function$
;
