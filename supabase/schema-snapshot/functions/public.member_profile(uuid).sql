CREATE OR REPLACE FUNCTION public.member_profile(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
               'review', case when v_s.show_reviews then f.review end,
               'sessionId', f.session_id,
               'spoilers', (v_s.show_reviews and f.review is not null and f.review_spoilers),
               'folded', (v_s.show_reviews and f.review is not null
                          and private.review_folded(v_caller, p_member, f.book_id, f.review_spoilers)),
               'likes', private.like_count(f.session_id),
               'liked', private.liked_by(v_caller, f.session_id)
             ) order by f.ended_on desc nulls last, f.created_at desc), '[]'::jsonb)
      into v_finished
      from (
        select x.* from (
          select distinct on (e.id) e.book_id, s.ended_on, s.rating, s.review, s.created_at,
                 s.id as session_id, s.review_spoilers
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
$function$
;
