CREATE OR REPLACE FUNCTION public.answer_buddy_invite(p_id uuid, p_join boolean)
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
  if p_join is null then
    raise exception 'buddy_answer_invalid' using errcode = '22023';
  end if;

  if not exists (select 1 from public.buddy_read_members
                  where buddy_read_id = p_id and member_id = v_caller and joined_at is null) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_join then
    perform private.buddy_lock_member(v_caller);
  end if;
  perform private.buddy_lock_read(p_id);
  if not exists (select 1 from public.buddy_read_members
                  where buddy_read_id = p_id and member_id = v_caller and joined_at is null) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if not p_join then
    delete from public.buddy_read_members where buddy_read_id = p_id and member_id = v_caller;
    return;
  end if;

  if not exists (select 1 from public.buddy_reads where id = p_id and status = 'active')
     or exists (select 1 from public.buddy_read_members x
                 where x.buddy_read_id = p_id and x.member_id <> v_caller
                   and private.blocked_either(x.member_id, v_caller)) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;
  update public.buddy_read_members set joined_at = clock_timestamp()
   where buddy_read_id = p_id and member_id = v_caller;
end;
$function$
;
