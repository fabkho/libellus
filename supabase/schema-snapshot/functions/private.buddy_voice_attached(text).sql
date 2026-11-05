CREATE OR REPLACE FUNCTION private.buddy_voice_attached(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_parts text[] := private.buddy_voice_parts(p_name);
begin
  if v_parts is null then
    return false;
  end if;
  return exists (select 1 from public.buddy_messages m
                  where m.author_id = v_parts[2]::uuid and m.client_id = v_parts[3]::uuid
                    and m.buddy_read_id = v_parts[1]::uuid
                    and m.voice_mime is not null and private.buddy_voice_ext(m.voice_mime) = v_parts[4]);
end;
$function$
;
