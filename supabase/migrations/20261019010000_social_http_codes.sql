-- Social: refusals with their own HTTP codes (social v1.1, "Version 1 debt").
--
-- The named refusals the social functions raise with errcode P0002 (not_found,
-- entry_not_found) and 54000 (rate_limited, follow_limit) reached the client as HTTP 500, the
-- code PostgREST gives any error it has no mapping for: a refusal read as a server fault by
-- every proxy, monitor and retry policy in front of it. PostgREST answers a SQLSTATE of the form
-- `PTnnn` with HTTP status nnn, so they are raised as PT404 (not_found, entry_not_found) and
-- PT429 (rate_limited, follow_limit) now. The message is unchanged: the client maps a refusal by
-- its message (data/socialShapes.ts), the body keeps it (message, details, hint). Raising PTnnn
-- inside a function is also what a pgTAP `throws_ok` sees (the SQLSTATE), so tests assert it.
-- Only the social functions change; the other P0002/54000 refusals of the app are not part of
-- this. Each function is re-created from its latest body (follow: social_s1; answer_request:
-- social_follows; block: social_hardening; set_entry_hidden: social_settings), grants restated.

-- ------------------------------------------------------------------------------ refusals

-- follow: as social_s1 has it, the refusals raised as PT404 / PT429.
create or replace function public.follow(p_member uuid)
returns jsonb
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
  if private.reachable(v_caller, p_member) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- One call at a time per member, so that parallel calls cannot slip past the limits.
  perform pg_advisory_xact_lock(hashtextextended('follow:' || v_caller::text, 0));
  -- Her setting cannot change under the decision below (set_private waits for this), and a block
  -- of this pair cannot interleave with it.
  perform 1 from public.social_settings where member_id = p_member for share;
  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, p_member)::text || greatest(v_caller, p_member)::text, 0));

  -- The check at the top ran before this lock: a block committed while we waited for it is only
  -- visible now. Ask again, and answer as for a stranger.
  if private.blocked_either(v_caller, p_member) or private.reachable(v_caller, p_member) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- Already following: nothing changes and nothing is counted, whatever the limits say.
  if exists (select 1 from public.follows
              where follower_id = v_caller and followee_id = p_member and accepted_at is not null) then
    return jsonb_build_object('state', 'following');
  end if;

  if (select count(*) from private.follow_calls
       where member_id = v_caller and at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  if (select count(*) from public.follows where follower_id = v_caller) >= 150
     or (select count(*) from public.follows
          where follower_id = v_caller and accepted_at is null) >= 20 then
    raise exception 'follow_limit' using errcode = 'PT429';
  end if;

  delete from private.follow_calls where member_id = v_caller and at < now() - interval '1 day';
  insert into private.follow_calls (member_id) values (v_caller);

  if not (private.social_of(p_member)).private then
    -- A waiting or declined request of hers becomes the follow.
    insert into public.follows (follower_id, followee_id, accepted_at)
    values (v_caller, p_member, now())
    on conflict (follower_id, followee_id)
    do update set accepted_at = now(), declined_at = null;
    return jsonb_build_object('state', 'following');
  end if;

  -- Private: a request, whether or not she follows the caller. Already asked or declined:
  -- nothing changes.
  insert into public.follows (follower_id, followee_id)
  values (v_caller, p_member)
  on conflict (follower_id, followee_id) do nothing;
  return jsonb_build_object('state', 'requested');
end;
$$;

-- answer_request: as social_follows has it (not_found as PT404).
create or replace function public.answer_request(p_member uuid, p_accept boolean)
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
  update public.follows
     set accepted_at = case when p_accept then now() end,
         declined_at = case when p_accept then null else now() end
   where follower_id = p_member and followee_id = v_caller
     and accepted_at is null and declined_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
end;
$$;

-- block: as social_hardening has it (not_found as PT404).
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

-- set_entry_hidden: as social_settings has it (entry_not_found as PT404).
create or replace function public.set_entry_hidden(p_entry uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- A null leaves the Book as it is: a missing value must never show what she hid.
  update public.library_entries
     set hidden = coalesce(p_hidden, hidden)
   where id = p_entry and member_id = v_member;
  if not found then
    raise exception 'entry_not_found' using errcode = 'PT404';
  end if;
end;
$$;


-- ------------------------------------------------------------------------------- grants

revoke all on function public.follow(uuid) from public, anon;
revoke all on function public.answer_request(uuid, boolean) from public, anon;
revoke all on function public.block(uuid) from public, anon;
revoke all on function public.set_entry_hidden(uuid, boolean) from public, anon;
grant execute on function public.follow(uuid) to authenticated;
grant execute on function public.answer_request(uuid, boolean) to authenticated;
grant execute on function public.block(uuid) to authenticated;
grant execute on function public.set_entry_hidden(uuid, boolean) to authenticated;
