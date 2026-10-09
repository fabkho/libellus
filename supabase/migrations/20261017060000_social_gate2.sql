-- Social v1, gate 2 (docs/proposals/social-v1-contract.md §1.5a): what the privacy review of the
-- whole of social v1 found. No critical or high leak; four points fixed here:
--   1. (medium) A Manual book's cover was a tracking pixel: `cover_url` of a member's own Book is
--      any https URL she typed, and every follower's browser fetched it when the feed opened
--      (their IP, their time). A cover of such a Book is now shown to others only on a host the
--      app's own sources use; else null, and the follower sees the cloth Placeholder.
--   2. (low) follow() decided "reachable" before it took the pair's lock and never again, so a
--      block committed while it waited let the follow insert. It asks again under the lock.
--   3. (low) The avatars select policy let a connected member list and fetch every object under a
--      member's folder, her old photos too. It now allows only her current photo and its small twin.
--   4. (low) A `reviewed` activity outlived the review: the feed showed "reviewed X" with no text
--      once the session's review was cleared. The feed leaves such a row out.
--
-- Each function below is re-created from its latest body, whole; only what is listed above
-- changed, and its grants are as they were (stated again at the end). Re-runnable: `create or
-- replace`, and the policy dropped before it is created.

-- ------------------------------------------------------- 1. covers of a member's own Books

-- Whether a Book's cover may be shown to somebody else. A catalogue Book (no owner) has the cover
-- the app's sources gave it. A Book of her own making (`owner_id`) has whatever https URL she
-- typed (use_own_edition, import), and showing it makes the viewer's browser call a host she
-- chose: a tracking pixel. So only a host the app's own sources use, matched on the whole host
-- (what follows it must be `/` or nothing, so `host@evil`, `host:80@evil`, `host.evil` and
-- `host#@evil` do not pass):
--   covers.openlibrary.org   Open Library covers (data/openLibrary.ts)
--   *.mzstatic.com           Apple's artwork (data/apple.ts; is1-ssl, is2-ssl, …)
--   books.fabkho.dev         the published Regal library (data/shelf.ts)
-- The project's own Storage holds no cover: the only bucket is the private `avatars`, and an own
-- cover is a URL, not an upload. If covers are ever uploaded, its host goes here.
-- The thumbhash and the two colours are harmless alone but describe the picture, so they go with
-- the URL: the callers drop all four together.
create or replace function private.cover_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_book.owner_id is null
      or p_book.cover_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|([a-z0-9-]+\.)+mzstatic\.com)(/|$)'
$$;

revoke all on function private.cover_shown(public.books) from public, anon, authenticated;

-- A Book as followers and reading pages see it. Every function that hands a Book to someone else
-- goes through this one: the feed, member_profile and member_want (by social_book_json), the
-- public reading page and its cards. The record's Book is built by name in member_reading_record,
-- which asks cover_shown too.
create or replace function private.reading_page_book_json(p_book public.books)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', p_book.id,
    'title', p_book.title,
    'authors', to_jsonb(p_book.authors),
    'published_year', p_book.published_year,
    'cover_url', case when private.cover_shown(p_book) then p_book.cover_url end,
    'cover_thumbhash', case when private.cover_shown(p_book) then p_book.cover_thumbhash end,
    'cover_dominant', case when private.cover_shown(p_book) then p_book.cover_dominant end,
    'cover_secondary', case when private.cover_shown(p_book) then p_book.cover_secondary end
  )
$$;

revoke all on function private.reading_page_book_json(public.books) from public, anon, authenticated;

-- ------------------------------------------------- 1. (again) the record's Book and its cover

create or replace function public.member_reading_record(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_s      public.social_settings;
  v_reads  jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.visible(v_caller, p_member) then
    return null;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_year then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', s.id,
             'entry_id', s.entry_id,
             'started_on', s.started_on,
             'ended_on', s.ended_on,
             'outcome', s.outcome,
             'rating', case when v_s.show_ratings then s.rating end,
             'created_at', s.created_at,
             'entry', jsonb_build_object(
               'page_count_override', e.page_count_override,
               -- The Book by the columns bookFromRow reads, named: never owner_id, nor a column added later.
               'book', jsonb_build_object(
                 'id', b.id,
                 'created_at', b.created_at,
                 'title', b.title,
                 'authors', b.authors,
                 'isbn13', b.isbn13,
                 'isbn10', b.isbn10,
                 'page_count', b.page_count,
                 'published_year', b.published_year,
                 'language', b.language,
                 'publisher', b.publisher,
                 'description', b.description,
                 -- A cover only where private.cover_shown says (1. above); else the Placeholder.
                 'cover_url', case when private.cover_shown(b) then b.cover_url end,
                 'cover_thumbhash', case when private.cover_shown(b) then b.cover_thumbhash end,
                 'cover_dominant', case when private.cover_shown(b) then b.cover_dominant end,
                 'cover_secondary', case when private.cover_shown(b) then b.cover_secondary end,
                 'source', b.source,
                 'apple_id', b.apple_id,
                 'openlibrary_edition_key', b.openlibrary_edition_key,
                 'openlibrary_work_key', b.openlibrary_work_key,
                 'format', b.format,
                 'goodreads', null)
             )
           ) order by s.ended_on nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_reads
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and not e.hidden
     and ((s.outcome = 'finished' and v_s.show_finished)
          or (s.outcome = 'abandoned' and v_s.show_abandoned));

  return jsonb_build_object(
    'reads', v_reads,
    'wantToRead', case when v_s.show_want then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden and e.status = 'want_to_read') end,
    'reading', case when v_s.show_reading then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden
          and exists (select 1 from public.reading_sessions s
                       where s.entry_id = e.id and s.outcome is null)) end
  );
end;
$$;

-- ------------------------------------------------------------------ 2. the follow race

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

-- ------------------------------------------------------------- 3. the photo, not the folder

-- An object of the avatars bucket the caller may see: her current photo (`accounts.avatar_path`,
-- `<id>/<hash>.webp|jpg`) or its small twin (`<id>/<hash>-128.webp|jpg`, as set_avatar names it),
-- of a member reachable for her (or herself). Not the older photos still in the folder until her
-- device deletes them, not any other file: the folder's id is what can_see_member_folder judges,
-- the name is what is compared here. Answers false, never raises (it runs inside a policy).
create or replace function public.can_see_member_file(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_folder text;
  v_path   text;
begin
  if p_name is null
     or p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}(-128)?\.(webp|jpg)$' then
    return false;
  end if;
  v_folder := split_part(p_name, '/', 1);
  if not public.can_see_member_folder(v_folder) then
    return false;
  end if;
  select a.avatar_path into v_path from public.accounts a where a.id = v_folder::uuid;
  return v_path is not null
     and (p_name = v_path
          or p_name = regexp_replace(v_path, '\.(webp|jpg)$', '-128.\1'));
end;
$$;

revoke all on function public.can_see_member_file(text) from public, anon;
grant execute on function public.can_see_member_file(text) to authenticated;

-- The policy of D4 judged the folder only. Now the whole object name.
drop policy if exists avatars_select_connected on storage.objects;
create policy avatars_select_connected on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_see_member_file(name)
  );

-- ------------------------------------------------------------------- 4. the feed

-- As before, but a `reviewed` row needs its review: the session's review is still there. The
-- test is inside the per-member range (before its `limit`), so a page is not cut short by rows
-- dropped afterwards. Nothing else hands out a `reviewed` row: the profile, the want list and
-- the record read the sessions themselves, never `activity`.
create or replace function public.feed(
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
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id,
             'at', t.visible_at,
             'member', private.member_card(v_caller, t.member_id),
             'kind', t.kind,
             'again', t.again,
             'day', t.on_day,
             'book', private.social_book_json(b),
             'rating', t.rating,
             'review', t.review
           ) order by t.visible_at desc, t.id desc), '[]'::jsonb)
    into v_out
    from (
      select a.id, a.member_id, a.kind, a.on_day, a.visible_at, a.entry_id,
             case when a.kind in ('finished', 'reviewed') and coalesce(f.show_ratings, true)
                  then rs.rating end as rating,
             case when a.kind in ('finished', 'reviewed') and coalesce(f.show_reviews, true)
                  then rs.review end as review,
             (a.kind = 'started' and coalesce(f.show_finished, true) and exists (
                select 1 from public.reading_sessions p
                 where p.entry_id = a.entry_id
                   and p.outcome = 'finished'
                   and p.id is distinct from a.session_id
                   and coalesce(p.ended_on, p.created_at::date)
                       <= coalesce(rs.started_on, rs.created_at::date)
             )) as again,
             e.book_id
        from (
          select fo.followee_id,
                 s.show_reading, s.show_want, s.show_finished, s.show_ratings,
                 s.show_reviews, s.show_abandoned
            from public.follows fo
            left join public.social_settings s on s.member_id = fo.followee_id
           where fo.follower_id = v_caller
             and fo.accepted_at is not null
             and not private.blocked_either(v_caller, fo.followee_id)
        ) f
        cross join lateral (
          select a.*
            from public.activity a
            join public.library_entries e on e.id = a.entry_id and not e.hidden
           where a.member_id = f.followee_id
             and a.visible_at <= now()
             and (p_before is null
                  or a.visible_at < p_before
                  or (p_before_id is not null and a.visible_at = p_before and a.id < p_before_id))
             and case a.kind
                   when 'started'   then coalesce(f.show_reading, true)
                   when 'want'      then coalesce(f.show_want, true)
                   when 'finished'  then coalesce(f.show_finished, true)
                   when 'abandoned' then coalesce(f.show_abandoned, true)
                   when 'reviewed'  then coalesce(f.show_reviews, true) and coalesce(f.show_finished, true)
                                         -- and a review that is still there (4. below)
                                         and exists (select 1 from public.reading_sessions r
                                                      where r.id = a.session_id
                                                        and nullif(btrim(r.review), '') is not null)
                   else false
                 end
           order by a.visible_at desc, a.id desc
           limit v_limit
        ) a
        join public.library_entries e on e.id = a.entry_id
        left join public.reading_sessions rs on rs.id = a.session_id
       order by a.visible_at desc, a.id desc
       limit v_limit
    ) t
    join public.books b on b.id = t.book_id;

  return v_out;
end;
$$;

-- ------------------------------------------------------------------------------- grants

revoke all on function public.feed(timestamptz, uuid, integer) from public, anon;
revoke all on function public.follow(uuid) from public, anon;
revoke all on function public.member_reading_record(uuid) from public, anon;
grant execute on function public.feed(timestamptz, uuid, integer) to authenticated;
grant execute on function public.follow(uuid) to authenticated;
grant execute on function public.member_reading_record(uuid) to authenticated;
