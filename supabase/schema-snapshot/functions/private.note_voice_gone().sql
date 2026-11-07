CREATE OR REPLACE FUNCTION private.note_voice_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  insert into private.buddy_voice_trash (bucket, path)
  values ('note-voice', old.voice_object)
  on conflict do nothing;
  if coalesce(current_setting('buddy_voice.kicked', true), '') <> 'on' then
    perform set_config('buddy_voice.kicked', 'on', true);
    perform private.buddy_voice_kick();
  end if;
  return null;
exception when others then
  -- Never costs the delete or the account its success; the hourly job finds the object by the sweep's second rule (the uploads nobody sent).
  raise warning 'note-voice: object of note % not queued: %', old.id, sqlerrm;
  return null;
end;
$function$
;
