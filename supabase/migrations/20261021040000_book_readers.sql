-- Readers on a Book's page (social v2a contract §1.5; item 3 of social-v1.md, only the people she follows):
-- the members the caller follows who hold the same work as a Book, each with the one state of hers that is
-- most relevant, and only what her own profile shows the caller (member_profile's rules: the seven switches,
-- hidden Books, blocks both ways), never a second set of rules.
--
--   book_readers(p_book, p_after, p_limit) -> { total, items: [{ member, state, day, rating, review, spoilers,
--                                               folded, sessionId, likes, liked }], next }
--
-- "Same work" is what circle_reading and both_read match: the same books.id, or the same non-null
-- openlibrary_work_key (any edition), except an edition the check failed (a planted work key must not pair
-- readers), unless it is p_book itself. A Manual book, a Book the caller may not read (a failed Catalogue row
-- she does not hold) and an unknown id answer an empty list, as a Book nobody reads does.
--
-- Her state by precedence: Reading (an open read, show_reading), else Finished (her latest finished read, show_finished;
-- stars with show_ratings, the review with show_reviews, folded as the feed folds it), else Abandoned (show_abandoned),
-- else Wants to read (show_want). A member with nothing to show for the Book is not listed. Order: Finished with a
-- review she shows (newest), Finished without, Reading, Abandoned, Wants to read; a missing day last, then member id.
-- A keyset page (`next` is the next call's p_after), 50 at most.
--
-- Like feed and member_profile it counts no calls: it writes nothing and its work is bounded (at most 150
-- followed members, one page).
--
-- Re-runnable: create or replace.

create or replace function public.book_readers(p_book uuid, p_after jsonb default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_book   public.books;
  v_work   text;
  v_rank   integer;
  v_dk     date;
  v_member uuid;
  v_result jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if p_after is not null then
    if jsonb_typeof(p_after) <> 'object'
       or jsonb_typeof(p_after -> 'rank') is distinct from 'number'
       or jsonb_typeof(p_after -> 'day') is distinct from 'string'
       or jsonb_typeof(p_after -> 'member') is distinct from 'string' then
      raise exception 'after_invalid' using errcode = '22023';
    end if;
    v_rank := (p_after ->> 'rank')::integer;
    v_dk := (p_after ->> 'day')::date;
    v_member := (p_after ->> 'member')::uuid;
  end if;

  select * into v_book from public.books b where b.id = p_book;
  -- No such Book, a Manual book (no work, the owner's alone) or a failed Catalogue row she does not hold: nobody.
  if not found or v_book.owner_id is not null
     or (v_book.check_failed
         and not exists (select 1 from public.library_entries e where e.member_id = v_caller and e.book_id = v_book.id)) then
    return jsonb_build_object('total', 0, 'items', '[]'::jsonb, 'next', null);
  end if;
  v_work := v_book.openlibrary_work_key;

  with mine as (
    -- Followed (accepted), no block either way, with what each lets the caller see.
    select f.followee_id as member_id, s.show_reading, s.show_want, s.show_finished, s.show_abandoned,
           s.show_ratings, s.show_reviews
      from public.follows f
      cross join lateral private.social_of(f.followee_id) s
     where f.follower_id = v_caller and f.accepted_at is not null
       and f.followee_id <> v_caller
       and private.visible(v_caller, f.followee_id)
  ), ents as (
    select m.*, e.id as entry_id, e.status, e.added_at
      from mine m
      join public.library_entries e on e.member_id = m.member_id and not e.hidden
      join public.books b on b.id = e.book_id
     where b.id = p_book
        or (v_work is not null and b.openlibrary_work_key = v_work and not b.check_failed)
  ), who as (
    select distinct on (member_id) member_id, show_ratings, show_reviews from ents
  ), reading as (
    select distinct on (x.member_id) x.member_id, s.started_on as day
      from ents x
      join public.reading_sessions s on s.entry_id = x.entry_id and s.outcome is null
     where x.show_reading
     order by x.member_id, s.started_on desc nulls last, s.created_at desc
  ), finished as (
    select distinct on (x.member_id) x.member_id, s.id as session_id, s.ended_on as day, s.rating, s.review,
           s.review_spoilers
      from ents x
      join public.reading_sessions s on s.entry_id = x.entry_id and s.outcome = 'finished'
     where x.show_finished
     order by x.member_id, s.ended_on desc nulls last, s.created_at desc
  ), abandoned as (
    select distinct on (x.member_id) x.member_id, s.ended_on as day
      from ents x
      join public.reading_sessions s on s.entry_id = x.entry_id and s.outcome = 'abandoned'
     where x.show_abandoned
     order by x.member_id, s.ended_on desc nulls last, s.created_at desc
  ), wants as (
    select distinct on (x.member_id) x.member_id, x.added_at::date as day
      from ents x
     where x.show_want and x.status = 'want_to_read'
     order by x.member_id, x.added_at desc
  ), picked as (
    select w.member_id,
           case when r.member_id is not null then 'reading'
                when f.member_id is not null then 'finished'
                when a.member_id is not null then 'abandoned'
                when t.member_id is not null then 'want' end as state,
           case when r.member_id is not null then r.day
                when f.member_id is not null then f.day
                when a.member_id is not null then a.day
                else t.day end as day,
           case when r.member_id is null and f.member_id is not null and w.show_ratings then f.rating end as rating,
           case when r.member_id is null and f.member_id is not null and w.show_reviews and btrim(f.review) <> ''
                then f.review end as review,
           case when r.member_id is null then f.session_id end as session_id,
           case when r.member_id is null then f.review_spoilers else false end as spoilers
      from who w
      left join reading r on r.member_id = w.member_id
      left join finished f on f.member_id = w.member_id
      left join abandoned a on a.member_id = w.member_id
      left join wants t on t.member_id = w.member_id
  ), keyed as (
    select p.*,
           case when p.state = 'finished' and p.review is not null then 1
                when p.state = 'finished' then 2
                when p.state = 'reading' then 3
                when p.state = 'abandoned' then 4
                else 5 end as rk,
           coalesce(p.day, date '0001-01-01') as dk
      from picked p
     where p.state is not null
  ), page as (
    select k.*, row_number() over (order by k.rk, k.dk desc, k.member_id) as n
      from keyed k
     where v_rank is null
        or k.rk > v_rank
        or (k.rk = v_rank and (k.dk < v_dk or (k.dk = v_dk and k.member_id > v_member)))
     order by k.rk, k.dk desc, k.member_id
     limit v_limit + 1
  )
  select jsonb_build_object(
           'total', (select count(*) from keyed),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'member', private.member_card(v_caller, g.member_id),
                        'state', g.state,
                        'day', g.day,
                        'rating', g.rating,
                        'review', g.review,
                        'spoilers', (g.review is not null and g.spoilers),
                        'folded', (g.review is not null and private.review_folded(v_caller, g.member_id, p_book, g.spoilers)),
                        'sessionId', g.session_id,
                        'likes', case when g.session_id is not null then private.like_count(g.session_id) else 0 end,
                        'liked', case when g.session_id is not null then private.liked_by(v_caller, g.session_id) else false end
                      ) order by g.n)
                      from page g where g.n <= v_limit), '[]'::jsonb),
           'next', (select jsonb_build_object('rank', g.rk, 'day', g.dk, 'member', g.member_id)
                      from page g
                     where g.n = v_limit and exists (select 1 from page h where h.n > v_limit))
         )
    into v_result;

  return v_result;
end;
$$;

comment on function public.book_readers(uuid, jsonb, integer) is
  'Social v2a §1.5: the followed members who hold the same work as p_book, one row each with her most relevant '
  'state and only what her profile shows the caller; a keyset page of 50 at most (next = the next p_after).';

revoke all on function public.book_readers(uuid, jsonb, integer) from public, anon;
grant execute on function public.book_readers(uuid, jsonb, integer) to authenticated;
