CREATE OR REPLACE FUNCTION public.set_buddy_hand(p_id uuid, p_through integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if (select status from public.buddy_reads where id = p_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  v_parts := private.buddy_parts(p_id);
  if p_through is not null and (p_through < 0 or p_through > v_parts) then
    raise exception 'buddy_position_invalid' using errcode = '22023';
  end if;

  update public.buddy_read_members set hand_through = p_through
   where buddy_read_id = p_id and member_id = v_caller
  returning * into v_me;
  return private.buddy_me(v_me, v_parts);
end;
$function$
;
