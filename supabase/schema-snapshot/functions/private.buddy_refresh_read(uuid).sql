CREATE OR REPLACE FUNCTION private.buddy_refresh_read(p_read uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member uuid;
begin
  perform private.buddy_lock_read(p_read);
  for v_member in
    select m.member_id from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.joined_at is not null and m.entry_id is not null
     order by m.member_id
  loop
    perform private.buddy_refresh(p_read, v_member);
  end loop;
end;
$function$
;
