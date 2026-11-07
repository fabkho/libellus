CREATE OR REPLACE FUNCTION private.note_voice_readable(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.note_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null or v_parts[1] <> v_caller::text then
    return false;
  end if;
  return exists (select 1 from public.room_messages m
                   join public.rooms r on r.id = m.room_id
                  where m.author_id = v_caller and m.voice_object = p_name
                    and m.kind = 'voice' and m.deleted_at is null and m.visibility = 'private'
                    and r.kind = 'notes');
end;
$function$
;
