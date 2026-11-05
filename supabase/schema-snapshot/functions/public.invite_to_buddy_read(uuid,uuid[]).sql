CREATE OR REPLACE FUNCTION public.invite_to_buddy_read(p_id uuid, p_members uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);

  perform private.buddy_lock_member(v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status <> 'active' then
    raise exception 'buddy_read_ended' using errcode = 'PT409';
  end if;
  perform private.buddy_rate(v_caller, 'invite', 20);
  return private.buddy_invite(p_id, v_caller, p_members);
end;
$function$
;
