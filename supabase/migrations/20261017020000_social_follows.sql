-- Social version 1, D2 (docs/proposals/social-v1-contract.md §1.1, §1.4, §1.5 "D2: following"):
-- opening a follow link, following, asking, answering, unfollowing, removing a follower, blocking.
--
-- D1 made the tables (follows, blocks, follow_link_views, private.follow_calls) and the helpers
-- that say who may reach whom; this migration only adds the functions that write and list them.
-- No new tables. Every function here reads the caller from `auth.uid()`, never from an argument.
--
-- A follow link (`follow_target`) shows a member's card to whoever opens it, unless one of them
-- blocked the other, and remembers who opened it (`follow_link_views`): that is what lets a
-- stranger reach a private account at all, to ask. A private account answers a follow with a
-- request, also when she already follows the asker (following back asks, as anyone would); a public
-- one with a follow at once. She answers a request by accepting or declining; a declined request
-- stays in the table and to the asker it looks like one still waiting: nothing in any answer here
-- tells him otherwise, and he can only withdraw it. A block cuts follows and requests both ways,
-- forgets both link views, and the blocked member can neither open her link nor ask again; unblocking
-- brings nothing back.
--
-- A script must not be able to sweep the member list or fill the tables: follow() refuses 30 calls
-- an hour (the calls are logged in private.follow_calls, rows older than a day are deleted by the
-- next call) and refuses more than 150 follows and requests in all, or 20 that are not accepted.
--
--   follow_target(token)          her card, whether she is private, and where the caller stands
--   follow(member)                'following' (public, or already) or 'requested'
--   withdraw_request(member)      the caller's own request, declined or not
--   answer_request(member, accept) a request to the caller that is neither accepted nor declined
--   unfollow(member)              the caller's follow or request
--   remove_follower(member)       that member's follow or request to the caller
--   block(member) / unblock(member)
--   my_people()                   { following, followers, requests, requested }, by name
--   my_blocked()                  the members she blocked, newest first, without photos
--
-- Refusals: not_signed_in (42501), not_found (P0002: unknown, blocked either way or not reachable,
-- always the same answer), follow_self (22023), follow_limit and rate_limited (54000).

-- ----------------------------------------------------------------- follow link

-- The card behind a follow link, and the caller's state towards her. Null for a malformed, unknown
-- or renewed token and when either blocked the other. Opening it is remembered, so that a private
-- account's card, photo and "Ask to follow" reach the caller.
create or replace function public.follow_target(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller  uuid := auth.uid();
  v_owner   uuid;
  v_follow  public.follows;
  v_state   text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select s.member_id into v_owner from public.social_settings s where s.follow_token = p_token;
  if v_owner is null or private.blocked_either(v_caller, v_owner) then
    return null;
  end if;

  if v_owner = v_caller then
    v_state := 'self';
  else
    insert into public.follow_link_views (visitor_id, member_id)
    values (v_caller, v_owner)
    on conflict do nothing;

    select * into v_follow from public.follows
     where follower_id = v_caller and followee_id = v_owner;
    v_state := case
      when not found then 'none'
      when v_follow.accepted_at is not null then 'following'
      else 'requested'            -- asked, or declined: the asker cannot tell
    end;
  end if;

  return jsonb_build_object(
    'member', private.member_card(v_caller, v_owner),
    'private', (private.social_of(v_owner)).private,
    'state', v_state
  );
end;
$$;

-- --------------------------------------------------------------------- following

-- Follow a member: at once when her account is public, else as a request. The checks in the
-- contract's order: herself, reachable, the hourly limit, the follow limits.
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
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- One call at a time per member, so that parallel calls cannot slip past the limits.
  perform pg_advisory_xact_lock(hashtextextended('follow:' || v_caller::text, 0));

  if (select count(*) from private.follow_calls
       where member_id = v_caller and at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;
  if (select count(*) from public.follows where follower_id = v_caller) >= 150
     or (select count(*) from public.follows
          where follower_id = v_caller and accepted_at is null) >= 20 then
    raise exception 'follow_limit' using errcode = '54000';
  end if;

  delete from private.follow_calls where member_id = v_caller and at < now() - interval '1 day';
  insert into private.follow_calls (member_id) values (v_caller);

  if exists (select 1 from public.follows
              where follower_id = v_caller and followee_id = p_member and accepted_at is not null) then
    return jsonb_build_object('state', 'following');
  end if;

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

-- The caller takes back her request (declined or not). Nothing to delete: no error. A follow
-- already accepted is not a request and stays (unfollow ends it).
create or replace function public.withdraw_request(p_member uuid)
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
  delete from public.follows
   where follower_id = v_caller and followee_id = p_member and accepted_at is null;
end;
$$;

-- She accepts or declines a request to her that is neither accepted nor declined; any other case
-- is not_found. A decline is final until the asker withdraws and asks again.
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
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- The caller stops following (or asking). Silent when there is nothing to delete.
create or replace function public.unfollow(p_member uuid)
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
  delete from public.follows where follower_id = v_caller and followee_id = p_member;
end;
$$;

-- She removes a follower (or a request of his). He is not told.
create or replace function public.remove_follower(p_member uuid)
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
  delete from public.follows where follower_id = p_member and followee_id = v_caller;
end;
$$;

-- --------------------------------------------------------------------- blocking

-- Block a member: follows and requests both ways go, the block is written once, and both link
-- views go (he can neither open her link nor ask again, and her link no longer lets her reach
-- him). An unknown id answers not_found, as a member she cannot reach does: a stranger must not
-- learn whether it is a member.
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
    raise exception 'not_found' using errcode = 'P0002';
  end if;

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

-- Lift her block. Nothing to delete: no error. The follows do not come back.
create or replace function public.unblock(p_member uuid)
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
  delete from public.blocks where blocker_id = v_caller and blocked_id = p_member;
end;
$$;

-- ----------------------------------------------------------------------- lists

-- Her people: who she follows, who follows her (and whether she follows back), who asked her, and
-- her own pending asks (declined ones too: they look the same to her). Each list by name (nulls
-- last), then id; requests newest first.
create or replace function public.my_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'following', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.followee_id)
                       order by private.member_name(f.followee_id) nulls last, f.followee_id)
        from public.follows f
       where f.follower_id = v_caller and f.accepted_at is not null
    ), '[]'::jsonb),
    'followers', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.follower_id)
                       || jsonb_build_object('followsBack', exists (
                            select 1 from public.follows b
                             where b.follower_id = v_caller and b.followee_id = f.follower_id
                               and b.accepted_at is not null))
                       order by private.member_name(f.follower_id) nulls last, f.follower_id)
        from public.follows f
       where f.followee_id = v_caller and f.accepted_at is not null
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.follower_id)
                       || jsonb_build_object('askedAt', f.requested_at)
                       order by f.requested_at desc, f.follower_id)
        from public.follows f
       where f.followee_id = v_caller and f.accepted_at is null and f.declined_at is null
    ), '[]'::jsonb),
    'requested', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.followee_id)
                       order by private.member_name(f.followee_id) nulls last, f.followee_id)
        from public.follows f
       where f.follower_id = v_caller and f.accepted_at is null
    ), '[]'::jsonb)
  );
end;
$$;

-- The members she blocked, newest block first. A block hides photos both ways: the photo is null.
create or replace function public.my_blocked()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.blocked_id,
                                        'name', private.member_name(b.blocked_id),
                                        'photo', null)
                     order by b.created_at desc, b.blocked_id)
      from public.blocks b
     where b.blocker_id = v_caller
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.follow_target(text) from public, anon;
revoke all on function public.follow(uuid) from public, anon;
revoke all on function public.withdraw_request(uuid) from public, anon;
revoke all on function public.answer_request(uuid, boolean) from public, anon;
revoke all on function public.unfollow(uuid) from public, anon;
revoke all on function public.remove_follower(uuid) from public, anon;
revoke all on function public.block(uuid) from public, anon;
revoke all on function public.unblock(uuid) from public, anon;
revoke all on function public.my_people() from public, anon;
revoke all on function public.my_blocked() from public, anon;
grant execute on function public.follow_target(text) to authenticated;
grant execute on function public.follow(uuid) to authenticated;
grant execute on function public.withdraw_request(uuid) to authenticated;
grant execute on function public.answer_request(uuid, boolean) to authenticated;
grant execute on function public.unfollow(uuid) to authenticated;
grant execute on function public.remove_follower(uuid) to authenticated;
grant execute on function public.block(uuid) to authenticated;
grant execute on function public.unblock(uuid) to authenticated;
grant execute on function public.my_people() to authenticated;
grant execute on function public.my_blocked() to authenticated;
