CREATE OR REPLACE FUNCTION private.buddy_voice_writable(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_parts  text[] := private.buddy_voice_parts(p_name);
begin
  if v_caller is null or v_parts is null or v_parts[2] <> v_caller::text then
    return false;
  end if;
  if not exists (select 1 from public.buddy_read_members m
                   join public.buddy_reads r on r.id = m.buddy_read_id
                  where m.buddy_read_id = v_parts[1]::uuid and m.member_id = v_caller and m.joined_at is not null
                    and r.status <> 'archived') then
    return false;
  end if;
  return (select count(*) from storage.objects o
           where o.bucket_id = 'buddy-voice' and o.owner_id = v_caller::text
             and o.created_at > now() - interval '1 hour') < 20;
end;
$function$
;
