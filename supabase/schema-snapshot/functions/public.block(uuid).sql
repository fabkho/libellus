CREATE OR REPLACE FUNCTION public.block(p_member uuid)
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
  if p_member is not distinct from v_caller then
    raise exception 'follow_self' using errcode = '22023';
  end if;
  if private.reachable(v_caller, p_member) is not true
     and not exists (select 1 from public.blocks where blocker_id = v_caller and blocked_id = p_member) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, p_member)::text || greatest(v_caller, p_member)::text, 0));

  delete from public.follows
   where (follower_id = v_caller and followee_id = p_member)
      or (follower_id = p_member and followee_id = v_caller);
  insert into public.blocks (blocker_id, blocked_id)
  values (v_caller, p_member)
  on conflict do nothing;
  delete from public.follow_link_views
   where (visitor_id = v_caller and member_id = p_member)
      or (visitor_id = p_member and member_id = v_caller);
end;
$function$
;
