-- Social v1, hardening after gate 1's leak review (docs/proposals/social-v1-contract.md §1.5a).
--
-- The review found nothing that lets a stranger in, but two holes and some lesser points:
--   1. A declined request survived its owner going public: it was then the only "requested" left
--      on a public account, so it told the asker he was declined. Going public now deletes it.
--   2. A Book she hid from followers stayed on her public reading page and its cards. Hidden Books
--      now leave `reading_page_reads`/`reading_page_reading` (and so every section built on them)
--      and `public_book_card` answers null for one.
--   3. Two races: follow() could decide public/private on a setting that set_private() changed
--      meanwhile, and follow() and block() of one pair could interleave. follow() now shares the
--      owner's settings row and both take one advisory lock per pair.
--   4. member_reading_record() built the Book as `to_jsonb(b) - 'owner_id'`: any column added to
--      `books` later would leak. It names its columns now.
--   5. private.social_config and private.follow_calls had no RLS: enabled, no policies (only
--      definer functions reach them).
--   6. The comment on member_profile said it answers for herself; it answers null.
--
-- Each function below is re-created from its latest body, whole; only what is listed above
-- changed, and its grants are as they were.

-- ---------------------------------------------------- 1. a decline does not survive going public

-- Private or public. Going public (false) accepts every request that waits and was not declined,
-- and deletes the declined ones.
create or replace function public.set_private(p_private boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set private = coalesce(p_private, private), updated_at = now()
   where member_id = v_member;
  if p_private is false then
    update public.follows
       set accepted_at = now()
     where followee_id = v_member and accepted_at is null and declined_at is null;
    -- A declined request does not survive: it would be the only "requested" left on a public
    -- account, and so tell the asker he was declined.
    delete from public.follows
     where followee_id = v_member and accepted_at is null and declined_at is not null;
  end if;
  return private.my_social_json(v_member);
end;
$$;

-- ------------------------------------------------------ 2. hidden Books leave the public page

-- Her finished reads, each with its place among the entry's finished reads (1 = first); not hidden.
create or replace function private.reading_page_reads(p_member uuid)
returns table (entry_id uuid, book_id uuid, session_id uuid, started_on date, ended_on date,
               rating smallint, review text, pages integer, created_at timestamptz, nth bigint)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.id, e.book_id, s.id, s.started_on, s.ended_on, s.rating, s.review,
         coalesce(e.page_count_override, b.page_count), s.created_at,
         row_number() over (partition by e.id order by s.ended_on nulls first, s.created_at)
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and not e.hidden and s.outcome = 'finished'
$$;

-- Currently reading: the newest started first; not hidden.
create or replace function private.reading_page_reading(p_member uuid)
returns table (book_id uuid, started_on date)
language sql
stable
set search_path = pg_catalog, public
as $$
  select e.book_id, s.started_on
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
   where e.member_id = p_member and not e.hidden
   order by s.started_on desc nulls last, s.created_at desc
   limit 6
$$;

-- One Book's card behind a token, or null (no such token, or a Book the page neither shows nor shares,
-- or one she hid).
create or replace function public.public_book_card(p_token text, p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_page   public.reading_pages;
  v_entry  public.library_entries;
  v_book   public.books;
  v_ended  date;
  v_rating smallint;
  v_review text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' or p_book is null then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;
  select * into v_entry from public.library_entries where member_id = v_page.member_id and book_id = p_book and not hidden;
  if not found then
    return null;
  end if;
  if not exists (select 1 from public.reading_page_books where member_id = v_page.member_id and book_id = p_book)
     and p_book not in (select private.reading_page_shown_books(v_page)) then
    return null;
  end if;

  select * into v_book from public.books where id = p_book;
  select r.ended_on, r.rating, r.review into v_ended, v_rating, v_review
    from private.reading_page_reads(v_page.member_id) r
   where r.book_id = p_book
   order by r.ended_on desc nulls last, r.created_at desc
   limit 1;

  return jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'book', private.reading_page_book_json(v_book),
    'status', v_entry.status,
    'ended_on', v_ended,
    'rating', v_rating,
    'review', private.reading_page_review(v_page.member_id, p_book, v_review));
end;
$$;

-- ------------------------------------------------------------------------- 3. the races

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

-- Block a member: as before, under the pair's lock.
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

-- ------------------------------------------------------------ 4. the record's Book, by name

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
                 'cover_url', b.cover_url,
                 'cover_thumbhash', b.cover_thumbhash,
                 'cover_dominant', b.cover_dominant,
                 'cover_secondary', b.cover_secondary,
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

-- --------------------------------------------------------------------- 5. RLS, no policies

alter table private.social_config enable row level security;
alter table private.follow_calls enable row level security;

-- ------------------------------------------------------------------------- 6. a comment

comment on function public.member_profile(uuid) is
  'Social v1: a member as the caller may see her. Null unless reachable, and so null for the caller '
  'herself (the app shows her own Profile); a private card when she is not visible.';

-- ------------------------------------------------------------------------------- grants

revoke all on function public.set_private(boolean) from public, anon;
revoke all on function private.reading_page_reads(uuid) from public, anon, authenticated;
revoke all on function private.reading_page_reading(uuid) from public, anon, authenticated;
revoke all on function public.public_book_card(text, uuid) from public;
revoke all on function public.follow(uuid) from public, anon;
revoke all on function public.block(uuid) from public, anon;
revoke all on function public.member_reading_record(uuid) from public, anon;
grant execute on function public.set_private(boolean) to authenticated;
grant execute on function public.public_book_card(text, uuid) to anon, authenticated;
grant execute on function public.follow(uuid) to authenticated;
grant execute on function public.block(uuid) to authenticated;
grant execute on function public.member_reading_record(uuid) to authenticated;
