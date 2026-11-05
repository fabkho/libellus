CREATE OR REPLACE FUNCTION private.buddy_refresh_entry(p_entry uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_row record;
begin
  for v_row in
    select m.buddy_read_id, m.member_id
      from public.buddy_read_members m
      join public.buddy_reads r on r.id = m.buddy_read_id and r.status = 'active'
     where m.entry_id = p_entry and m.joined_at is not null
     order by m.buddy_read_id, m.member_id
  loop
    -- An entry that is being deleted (its sessions go with it) is the foreign key's to settle, and
    -- the read's lock is not taken for it.
    if exists (select 1 from public.library_entries where id = p_entry) then
      perform private.buddy_refresh(v_row.buddy_read_id, v_row.member_id);
    end if;
  end loop;
end;
$function$
;
