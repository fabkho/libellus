CREATE OR REPLACE FUNCTION public.leave_buddy_read(p_id uuid, p_delete_messages boolean DEFAULT false)
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
  perform private.buddy_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if coalesce(p_delete_messages, false) then
    delete from public.buddy_reactions r
     using public.buddy_messages m
     where m.id = r.message_id and m.buddy_read_id = p_id and r.member_id = v_caller;
    delete from public.buddy_messages where buddy_read_id = p_id and author_id = v_caller;
  end if;
  delete from public.buddy_read_members where buddy_read_id = p_id and member_id = v_caller;
end;
$function$
;
