CREATE OR REPLACE FUNCTION private.buddy_voice_readable(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.buddy_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null then
    return false;
  end if;
  if not exists (select 1 from public.buddy_read_members m
                  where m.buddy_read_id = v_parts[1]::uuid and m.member_id = v_caller and m.joined_at is not null) then
    return false;
  end if;
  if private.buddy_hidden(v_caller, v_parts[2]::uuid) then
    return false;
  end if;
  return exists (select 1 from public.buddy_messages x
                  where x.author_id = v_parts[2]::uuid and x.client_id = v_parts[3]::uuid
                    and x.buddy_read_id = v_parts[1]::uuid
                    and x.deleted_at is null and x.voice_mime is not null
                    and private.buddy_voice_ext(x.voice_mime) = v_parts[4]);
end;
$function$
;
