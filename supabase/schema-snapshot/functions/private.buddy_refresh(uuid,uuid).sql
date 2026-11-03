CREATE OR REPLACE FUNCTION private.buddy_refresh(p_read uuid, p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_m public.buddy_read_members;
begin
  for v_pass in 1 .. 2 loop
    select * into v_m from public.buddy_read_members
     where buddy_read_id = p_read and member_id = p_member and joined_at is not null;
    if not found then
      return;
    end if;
    -- An entry that is already deleted: the foreign key's set null is on its way and freezes her
    -- Section first (the before trigger below); do not move it now.
    if v_m.entry_id is not null
       and not exists (select 1 from public.library_entries where id = v_m.entry_id) then
      return;
    end if;

    if private.buddy_auto(p_read, v_m) is not distinct from v_m.auto_through then
      return;
    end if;
    if v_pass = 1 then
      perform private.buddy_lock_read(p_read);
    else
      update public.buddy_read_members set auto_through = private.buddy_auto(p_read, v_m)
       where buddy_read_id = p_read and member_id = p_member;
    end if;
  end loop;
end;
$function$
;
