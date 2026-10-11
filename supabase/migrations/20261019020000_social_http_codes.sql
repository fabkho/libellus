-- Social: refusals with their own HTTP codes, and People in pages (social v1.1, "Version 1 debt").
--
-- 1. HTTP codes. The named refusals the social functions raise with errcode P0002 (not_found,
--    entry_not_found) and 54000 (rate_limited, follow_limit) reached the client as HTTP 500, the
--    code PostgREST gives any error it has no mapping for: a refusal read as a server fault by
--    every proxy, monitor and retry policy in front of it. PostgREST answers a SQLSTATE of the form
--    `PTnnn` with HTTP status nnn, so they are raised as PT404 (not_found, entry_not_found) and
--    PT429 (rate_limited, follow_limit) now. The message is unchanged: the client maps a refusal by
--    its message (data/socialShapes.ts), the body keeps it (message, details, hint). Raising PTnnn
--    inside a function is also what a pgTAP `throws_ok` sees (the SQLSTATE), so tests assert it.
--    Only the social functions change; the other P0002/54000 refusals of the app are not part of
--    this. Each function is re-created from its latest body (follow: social_s1; answer_request:
--    social_follows; block: social_hardening; set_entry_hidden: social_settings), grants restated.
--
-- 2. Paging in People. Following and Followers answered whole (contract §1.5a accepted it); a
--    public account can have thousands of followers. my_people() now answers the first page of each
--    (30, newest follow first) and my_people_page(list, before, before_id, limit) the next ones, a
--    keyset on (accepted_at, member id) like feed(). Requests (at most 20 waiting) and Requested (at
--    most 20) stay whole. Two additions for what the whole list used to be used for: `followingIds`
--    (everyone she follows, 150 at most by the follow limit: the feed keeps only entries of people
--    she still follows, a page's "Remove" is offered by it) and `followsYou` on a Following row (the
--    sheet offers Remove for a person who follows her). Every row carries `at`, when the follow was
--    accepted: the keyset for the next page. A partial index serves the Followers keyset.

-- ------------------------------------------------------------- 1. HTTP codes

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

-- ------------------------------------------------------------- 2. People in pages

-- The Followers keyset: her followers newest first, from (followee_id, accepted_at, follower_id).
create index if not exists follows_followee_accepted
  on public.follows (followee_id, accepted_at desc, follower_id desc)
  where accepted_at is not null;

-- One page of her Following (p_list 'following') or Followers ('followers'), newest follow first,
-- `at` (when the follow was accepted) and the member's id the keyset: the page after the row
-- (p_before, p_before_id), as feed() has it. Followers carry `followsBack`, Following `followsYou`.
create or replace function private.people_page(
  p_caller    uuid,
  p_list      text,
  p_before    timestamptz,
  p_before_id uuid,
  p_limit     integer
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, private
as $$
begin
  if p_list = 'following' then
    return coalesce((
      select jsonb_agg(private.member_card(p_caller, t.id)
                       || jsonb_build_object(
                            'at', t.at,
                            'followsYou', exists (
                              select 1 from public.follows b
                               where b.follower_id = t.id and b.followee_id = p_caller
                                 and b.accepted_at is not null))
                       order by t.at desc, t.id desc)
        from (
          select f.followee_id as id, f.accepted_at as at
            from public.follows f
           where f.follower_id = p_caller and f.accepted_at is not null
             and (p_before is null
                  or f.accepted_at < p_before
                  or (p_before_id is not null and f.accepted_at = p_before and f.followee_id < p_before_id))
           order by f.accepted_at desc, f.followee_id desc
           limit p_limit
        ) t
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(private.member_card(p_caller, t.id)
                     || jsonb_build_object(
                          'at', t.at,
                          'followsBack', exists (
                            select 1 from public.follows b
                             where b.follower_id = p_caller and b.followee_id = t.id
                               and b.accepted_at is not null))
                     order by t.at desc, t.id desc)
      from (
        select f.follower_id as id, f.accepted_at as at
          from public.follows f
         where f.followee_id = p_caller and f.accepted_at is not null
           and (p_before is null
                or f.accepted_at < p_before
                or (p_before_id is not null and f.accepted_at = p_before and f.follower_id < p_before_id))
         order by f.accepted_at desc, f.follower_id desc
         limit p_limit
      ) t
  ), '[]'::jsonb);
end;
$$;

-- Her people: the first page (30) of who she follows and who follows her, newest follow first;
-- who asked her (newest ask first) and her own pending asks (declined ones too: they look the
-- same to her), each at most 20 and whole; and `followingIds`, everyone she follows (150 at most).
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
    'following', private.people_page(v_caller, 'following', null, null, 30),
    'followers', private.people_page(v_caller, 'followers', null, null, 30),
    'followingIds', coalesce((
      select jsonb_agg(f.followee_id order by f.accepted_at desc, f.followee_id desc)
        from public.follows f
       where f.follower_id = v_caller and f.accepted_at is not null
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

-- The next page of one list: p_list 'following' or 'followers', the page after the row
-- (p_before = its `at`, p_before_id = its id), at most p_limit (1..50, 30 by default). An array;
-- fewer than the limit: the end. Any other list: people_list_invalid (22023).
create or replace function public.my_people_page(
  p_list      text,
  p_before    timestamptz default null,
  p_before_id uuid default null,
  p_limit     integer default 30
)
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
  if p_list is null or p_list not in ('following', 'followers') then
    raise exception 'people_list_invalid' using errcode = '22023';
  end if;
  return private.people_page(v_caller, p_list, p_before, p_before_id,
                             least(greatest(coalesce(p_limit, 30), 1), 50));
end;
$$;

-- ------------------------------------------------------------------------------- grants

revoke all on function private.people_page(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.follow(uuid) from public, anon;
revoke all on function public.answer_request(uuid, boolean) from public, anon;
revoke all on function public.block(uuid) from public, anon;
revoke all on function public.set_entry_hidden(uuid, boolean) from public, anon;
revoke all on function public.my_people() from public, anon;
revoke all on function public.my_people_page(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.follow(uuid) to authenticated;
grant execute on function public.answer_request(uuid, boolean) to authenticated;
grant execute on function public.block(uuid) to authenticated;
grant execute on function public.set_entry_hidden(uuid, boolean) to authenticated;
grant execute on function public.my_people() to authenticated;
grant execute on function public.my_people_page(text, timestamptz, uuid, integer) to authenticated;
