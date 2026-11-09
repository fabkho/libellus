CREATE OR REPLACE FUNCTION private.note_voice_writable(p_name text)
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
  if not exists (select 1 from public.rooms r
                  where r.id = v_parts[2]::uuid and r.kind = 'notes' and private.has_work(v_caller, r.work_key)) then
    return false;
  end if;
  return (select count(*) from storage.objects o
           where o.bucket_id = 'note-voice' and o.name like v_caller::text || '/%'
             and o.owner_id = v_caller::text
             and o.created_at > now() - interval '1 hour') < 20;
end;
$function$
;
