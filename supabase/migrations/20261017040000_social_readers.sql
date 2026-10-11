-- Social version 1, D4 (docs/proposals/social-v1-contract.md §1.4, §1.5 "D4"): what a member
-- reads of the others.
--
-- D1 made the switches, D2 the follows, D3 the activity. This is the one place where they are
-- read back: the feed of the people she follows, a member's profile, her whole Want to read,
-- her reading record (the rows `web/app/data/stats.ts` already reads for the member's own
-- Profile, so the same figures can be drawn for her), and the photo's reach through Storage.
-- No new tables: functions and one Storage policy.
--
--   private.social_book_json(book)   `reading_page_book_json` plus "manual": a Book of her own
--                                    making, which a follower cannot open
--
--   feed(before, before_id, limit)   FeedEntry[]: what the members she follows (accepted, nobody
--                                    blocked either way) did, newest first, 30 a page (1 to 50)
--   member_profile(member)           null unless reachable; a private card unless visible; else
--                                    her figures and lists, each following her switches
--   member_want(member)              her whole Want to read, or null unless visible and shown
--   member_reading_record(member)    her closed reads in the shape of data/stats.ts, or null
--                                    unless visible and her year is shown
--   can_see_member_folder(folder)    a Storage folder is a member's photo she may see; false for
--                                    anything else, never an error (it runs inside a policy)
--   policy avatars_select_connected  the avatars bucket's select policy for connected members
--
-- Who may see what is decided here, at read time, from the current follows, blocks, switches
-- and hidden Books (private.reachable, private.visible, private.social_of): nothing is copied
-- into `activity` but the fact and its time. A row waits for its settle window (`visible_at`),
-- and a kind shows only where its switch is on (started: reading; want: want; finished:
-- finished; abandoned: abandoned; reviewed: reviews and finished). A rating, a review and the
-- word "again" are read live from the session and left out where their switch is off.
--
-- What never leaves, whatever she switches on: the reason she put a book down, her progress,
-- her reading days, her highlights and notes, her collections, her address, a Book she hid,
-- and anything at all to a member who is blocked either way, who only asked and waits, or who
-- is a stranger to a private account.
--
-- Refusals: not_signed_in (42501). Anything a member may not see answers null (or an empty
-- list in the feed): the same answer as an unknown member.

-- ------------------------------------------------------------------- helpers

-- A Book as followers see it: the page's Book plus whether it is her own manual one.
create or replace function private.social_book_json(p_book public.books)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select private.reading_page_book_json(p_book)
         || jsonb_build_object('manual', p_book.owner_id is not null)
$$;

revoke all on function private.social_book_json(public.books) from public, anon, authenticated;

-- ------------------------------------------------------------------ the feed

-- What the members she follows did: their `activity` rows that are settled, of entries not
-- hidden, of a kind their switches allow. One range of the `activity_feed` index per followed
-- member (each cut at the page size before the rows are merged), then the newest of them all.
-- `p_before` / `p_before_id` is the last row of the page before: the keyset (visible_at, id).
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

-- ------------------------------------------------------------------ a profile

-- A member as the caller may see her. Null unless reachable (herself too: the app shows her own
-- Profile); a private card when she is not visible; else her figures and lists, each following
-- her switches and leaving her hidden Books out.
create or replace function public.member_profile(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller   uuid := auth.uid();
  v_s        public.social_settings;
  v_follow   public.follows;
  v_state    text;
  v_card     jsonb;
  v_since    date;
  v_read     bigint;
  v_reading  bigint;
  v_want     bigint;
  v_readings jsonb := '[]'::jsonb;
  v_wants    jsonb := '[]'::jsonb;
  v_finished jsonb := '[]'::jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.reachable(v_caller, p_member) then
    return null;
  end if;

  v_s := private.social_of(p_member);
  v_card := private.member_card(v_caller, p_member);

  select * into v_follow from public.follows
   where follower_id = v_caller and followee_id = p_member;
  v_state := case
    when not found then 'none'
    when v_follow.accepted_at is not null then 'following'
    else 'requested'              -- asked, or declined: the asker cannot tell
  end;

  if not private.visible(v_caller, p_member) then
    return jsonb_build_object('member', v_card, 'private', v_s.private, 'state', v_state, 'visible', false);
  end if;

  -- The earliest start or end of a closed read she shows (an off section shows no date either).
  select min(least(s.started_on, s.ended_on)) into v_since
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
   where e.member_id = p_member and not e.hidden
     and ((s.outcome = 'finished' and v_s.show_finished)
          or (s.outcome = 'abandoned' and v_s.show_abandoned));

  if v_s.show_finished then
    select count(*) into v_read
      from public.library_entries e
     where e.member_id = p_member and not e.hidden
       and exists (select 1 from public.reading_sessions s
                    where s.entry_id = e.id and s.outcome = 'finished');

    select coalesce(jsonb_agg(
             jsonb_build_object(
               'book', private.social_book_json(b),
               'endedOn', f.ended_on,
               'rating', case when v_s.show_ratings then f.rating end,
               'review', case when v_s.show_reviews then f.review end
             ) order by f.ended_on desc nulls last, f.created_at desc), '[]'::jsonb)
      into v_finished
      from (
        select x.* from (
          select distinct on (e.id) e.book_id, s.ended_on, s.rating, s.review, s.created_at
            from public.library_entries e
            join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
           where e.member_id = p_member and not e.hidden
           order by e.id, s.ended_on desc nulls last, s.created_at desc
        ) x
        order by x.ended_on desc nulls last, x.created_at desc
        limit 12
      ) f
      join public.books b on b.id = f.book_id;
  end if;

  if v_s.show_reading then
    select count(*) into v_reading
      from public.library_entries e
     where e.member_id = p_member and not e.hidden
       and exists (select 1 from public.reading_sessions s
                    where s.entry_id = e.id and s.outcome is null);

    select coalesce(jsonb_agg(
             jsonb_build_object('book', private.social_book_json(b), 'startedOn', r.started_on)
             order by r.started_on desc nulls last, r.created_at desc), '[]'::jsonb)
      into v_readings
      from (
        select e.book_id, s.started_on, s.created_at
          from public.library_entries e
          join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
         where e.member_id = p_member and not e.hidden
         order by s.started_on desc nulls last, s.created_at desc
         limit 6
      ) r
      join public.books b on b.id = r.book_id;
  end if;

  if v_s.show_want then
    select count(*) into v_want
      from public.library_entries e
     where e.member_id = p_member and not e.hidden and e.status = 'want_to_read';

    select coalesce(jsonb_agg(
             jsonb_build_object('book', private.social_book_json(b), 'addedOn', w.added_at::date)
             order by w.added_at desc, w.id desc), '[]'::jsonb)
      into v_wants
      from (
        select e.id, e.book_id, e.added_at
          from public.library_entries e
         where e.member_id = p_member and not e.hidden and e.status = 'want_to_read'
         order by e.added_at desc, e.id desc
         limit 12
      ) w
      join public.books b on b.id = w.book_id;
  end if;

  return jsonb_build_object(
    'member', v_card,
    'private', v_s.private,
    'state', v_state,
    'visible', true,
    'followsYou', exists (select 1 from public.follows
                           where follower_id = p_member and followee_id = v_caller
                             and accepted_at is not null),
    'sections', jsonb_build_object(
      'reading', v_s.show_reading, 'want', v_s.show_want, 'finished', v_s.show_finished,
      'ratings', v_s.show_ratings, 'reviews', v_s.show_reviews, 'abandoned', v_s.show_abandoned,
      'year', v_s.show_year),
    'since', v_since,
    'counts', jsonb_build_object('read', v_read, 'reading', v_reading, 'want', v_want),
    'reading', v_readings,
    'want', v_wants,
    'finished', v_finished
  );
end;
$$;

-- Her whole Want to read, newest first (the profile's "See all"). Null unless she is visible and
-- shows it.
create or replace function public.member_want(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.visible(v_caller, p_member) or not (private.social_of(p_member)).show_want then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('book', private.social_book_json(b), 'addedOn', w.added_at::date)
           order by w.added_at desc, w.id desc), '[]'::jsonb)
    into v_out
    from public.library_entries w
    join public.books b on b.id = w.book_id
   where w.member_id = p_member and not w.hidden and w.status = 'want_to_read';

  return v_out;
end;
$$;

-- ------------------------------------------------------------- reading record

-- Her closed reads in exactly the rows `web/app/data/stats.ts` reads for the member's own Profile
-- (SESSION_COLUMNS: the session, and its entry's page count override with the Book's row, the
-- Goodreads rating left null), so the same figures are drawn from them. Finished reads only where
-- she shows what she finished, abandoned only where she shows what she put down; a rating only
-- where ratings are shown. Never the review, the reason, the days or the address. Null unless
-- she is visible and shows her year.
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
               -- The row as PostgREST gives it for `books(*, goodreads)`, without whose manual Book it is.
               'book', (to_jsonb(b) - 'owner_id') || jsonb_build_object('goodreads', null)
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

revoke all on function public.feed(timestamptz, uuid, integer) from public, anon;
revoke all on function public.member_profile(uuid) from public, anon;
revoke all on function public.member_want(uuid) from public, anon;
revoke all on function public.member_reading_record(uuid) from public, anon;
grant execute on function public.feed(timestamptz, uuid, integer) to authenticated;
grant execute on function public.member_profile(uuid) to authenticated;
grant execute on function public.member_want(uuid) to authenticated;
grant execute on function public.member_reading_record(uuid) to authenticated;

-- --------------------------------------------------------------------- photos

-- A folder of the avatars bucket (its first path segment, a member's id) whose photo the caller
-- may see: herself, or a member reachable for her. The policy below calls it with whatever folder
-- name an object has, so it answers false (never raises) for a name that is no uuid and for no
-- signed-in member.
create or replace function public.can_see_member_folder(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or p_folder is null
     or p_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return coalesce(private.can_see_photo(v_caller, p_folder::uuid), false);
end;
$$;

revoke all on function public.can_see_member_folder(text) from public, anon;
grant execute on function public.can_see_member_folder(text) to authenticated;

-- The photos of members she is connected to (who follows her, whom she follows, who asked either
-- way, who opened her link, and everyone while an account is public), beside her own folder's
-- avatars_select_own. A block hides both ways: private.reachable says no.
create policy avatars_select_connected on storage.objects
  for select to authenticated
  using (
    bucket_id = 'avatars'
    and public.can_see_member_folder((storage.foldername(name))[1])
  );
