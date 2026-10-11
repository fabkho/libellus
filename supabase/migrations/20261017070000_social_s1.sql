-- Social v1, security round S1 (docs/proposals/social-v1-contract.md §1.5a): what attacking the
-- running stack by hand (PostgREST, RPC, Storage, real accounts, two concurrent sessions) found.
-- Nothing critical or high; three points fixed here:
--   1. (medium-low) A Catalogue Book's cover was a tracking pixel for followers. Gate 2 kept
--      `cover_url` of a member's own Book from others unless its host is one the app's sources use,
--      but let every Book without an owner through, on the assumption that a Catalogue cover came
--      from those sources. It does not have to: `catalogue_book_for` stores the `cover_url` the
--      first member to add a new Book sent, and the next member to add it gets that row. So a member
--      could hand an attacker's URL to the followers of whoever adds the Book later (the follower's
--      browser fetches it when the feed or a profile opens). The host list now applies to every Book
--      that is handed to someone else, Catalogue Books included.
--   2. (low) `follow_target` checked `blocked_either` and inserted the follow_link_views row later,
--      without the pair lock `follow` and `block` take, so a block committed in between could not
--      see (and delete) the uncommitted row: it survived, and once she unblocked, the blocked member
--      was reachable again without opening her link. It takes the pair lock and asks again.
--   3. (low) `follow()` checked the rate and the size limits before it looked at "already following",
--      so a member at 150 follows got `follow_limit` for a member she already follows, where §1.5
--      says `following` and nothing changes. The already-following answer now comes first.
--
-- Not touched, on purpose: `catalogue_book_for` / `add_to_library` (a member may still give a new
-- Catalogue Book her own title, description and cover; the Catalogue's trust model is older than
-- social v1) and the member's own Library (she sees her own covers). Each function below is
-- re-created from its latest body, whole; only what is listed above changed, and its grants are as
-- they were (stated again at the end). Re-runnable: `create or replace`.

-- ------------------------------------------------------------- 1. covers of every Book shown to others

-- Whether a Book's cover may be shown to somebody else: https, and the whole host one of
--   covers.openlibrary.org   Open Library covers (data/openLibrary.ts)
--   *.mzstatic.com           Apple's artwork (data/apple.ts; is1-ssl, is2-ssl, …)
--   books.fabkho.dev         the published Regal library (data/shelf.ts)
-- (what follows the host must be `/` or nothing, so `host@evil`, `host:80@evil`, `host.evil` and
-- `host#@evil` do not pass). Every Book the app's own sources hand out has a cover on one of them,
-- so a normal Catalogue Book still shows its cover; one on any other host (a member made it) shows
-- the cloth Placeholder, and so does a Book without a URL (its thumbhash and colours describe a
-- picture nobody can see). No owner test any more: that was the hole. The callers drop the url,
-- the thumbhash and the two colours together, as before.
create or replace function private.cover_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_book.cover_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|([a-z0-9-]+\.)+mzstatic\.com)(/|$)',
    false)
$$;

revoke all on function private.cover_shown(public.books) from public, anon, authenticated;

-- ------------------------------------------------------------------- 2. follow_target and block

-- As before, but the pair's advisory lock (the one `follow` and `block` take, same key) is held
-- before the view is written, and the block is looked for again once it is held: a block that was
-- committed while this waited is answered as for a blocked visitor (null), and a block that comes
-- after waits for this to commit and then deletes the row it wrote. The first look stays: it spares
-- a blocked visitor, and an unknown token, the lock. Lock order is the same as `block`'s (only the
-- pair's lock), so the two cannot deadlock.
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
    perform pg_advisory_xact_lock(hashtextextended(
      'pair:' || least(v_caller, v_owner)::text || greatest(v_caller, v_owner)::text, 0));

    -- The look above ran before this lock: a block committed while we waited for it is only
    -- visible now. Ask again, before the view is written, and answer as for a blocked visitor.
    if private.blocked_either(v_caller, v_owner) then
      return null;
    end if;

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

-- ------------------------------------------------------------- 3. follow: already following first

-- As before, but "already following" is answered right after the pair's lock and the second look
-- for a block, before the rate and size limits and before the call is logged: nothing is written,
-- so a member at the limit can still be told she follows someone (§1.5: "Already following:
-- `following`, nothing changes"). Everything else, in the same order.
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
  -- Her setting cannot change under the decision below (set_private waits for this), and a block
  -- of this pair cannot interleave with it.
  perform 1 from public.social_settings where member_id = p_member for share;
  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, p_member)::text || greatest(v_caller, p_member)::text, 0));

  -- The check at the top ran before this lock: a block committed while we waited for it is only
  -- visible now. Ask again, and answer as for a stranger.
  if private.blocked_either(v_caller, p_member) or private.reachable(v_caller, p_member) is not true then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Already following: nothing changes and nothing is counted, whatever the limits say.
  if exists (select 1 from public.follows
              where follower_id = v_caller and followee_id = p_member and accepted_at is not null) then
    return jsonb_build_object('state', 'following');
  end if;

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

-- ------------------------------------------------------------------------------- grants

revoke all on function public.follow_target(text) from public, anon;
revoke all on function public.follow(uuid) from public, anon;
grant execute on function public.follow_target(text) to authenticated;
grant execute on function public.follow(uuid) to authenticated;
