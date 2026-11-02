CREATE OR REPLACE FUNCTION private.buddy_refresh(p_read uuid, p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_m       public.buddy_read_members;
  v_f       numeric;
  v_through smallint;
begin
  perform private.buddy_lock_read(p_read);

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

  v_f := private.buddy_fraction(v_m.entry_id, v_m.joined_at);
  if v_f is not null then
    select count(*)::smallint into v_through
      from public.buddy_read_sections s
     where s.buddy_read_id = p_read and s.kind = 'part' and s.to_fraction <= v_f + 0.005;
  end if;

  if v_through is distinct from v_m.auto_through then
    update public.buddy_read_members set auto_through = v_through
     where buddy_read_id = p_read and member_id = p_member;
  end if;
end;
$function$
;
