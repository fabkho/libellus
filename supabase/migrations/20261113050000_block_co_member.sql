-- A member can block a co-member of a buddy read.
--
-- public.block refused with not_found unless private.reachable(caller, target), and reachable is false
-- for a member with a PRIVATE profile whom the caller does not follow. A person who joined a room by its
-- link (or hosts it) with a private profile could therefore not be blocked, and her messages stayed in the
-- room. Now the guard also passes for two people who are joined in one buddy read
-- (private.buddy_co_members). Nothing new is revealed: a co-member's card is already in the room.
--
-- buddy_co_members is false when either has blocked the other, so "she already blocked me" is still
-- not_found, as for a stranger. The third way through, an existing block of the caller's, stays: blocking
-- again is idempotent.
--
-- Same signature, security definer, search_path and grants as before (20261017050000_social_hardening).
-- Only the guard changed; the rest of the body is the one of that migration.

create or replace function public.block(p_member uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
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
     and private.buddy_co_members(v_caller, p_member) is not true
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
$$;

revoke all on function public.block(uuid) from public, anon;
grant execute on function public.block(uuid) to authenticated;
