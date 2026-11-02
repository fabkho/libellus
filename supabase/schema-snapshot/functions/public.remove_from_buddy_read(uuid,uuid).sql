CREATE OR REPLACE FUNCTION public.remove_from_buddy_read(p_id uuid, p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  if p_member is not distinct from v_caller then
    raise exception 'buddy_remove_self' using errcode = '22023';
  end if;
  perform private.buddy_lock_read(p_id);
  perform private.buddy_host_gate(p_id, v_caller);
  delete from public.buddy_read_members where buddy_read_id = p_id and member_id = p_member;
  if found then
    insert into private.buddy_read_removed (buddy_read_id, member_id) values (p_id, p_member)
    on conflict (buddy_read_id, member_id) do update set removed_at = clock_timestamp();
  end if;
end;
$function$
;
