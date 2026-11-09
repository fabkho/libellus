CREATE OR REPLACE FUNCTION private.note_voice_attached(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_parts text[] := private.note_voice_parts(p_name);
begin
  if v_parts is null then
    return false;
  end if;
  return exists (select 1 from public.room_messages m
                  where m.author_id = v_parts[1]::uuid and m.client_id = v_parts[3]::uuid
                    and m.voice_object = p_name);
end;
$function$
;
