CREATE OR REPLACE FUNCTION public.member_finished(p_member uuid, p_after jsonb DEFAULT NULL::jsonb, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 150);
  v_s      public.social_settings;
  v_result jsonb;
  v_day    date;
  v_at     timestamptz;
  v_entry  uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  -- A JSON null is no cursor (the first page), whether it arrives as SQL null or as jsonb 'null'. Anything
  -- else must be { day: date, at: timestamp, entry: uuid }; a value that is not is after_invalid, as
  -- book_readers refuses one.
  if p_after is not null and jsonb_typeof(p_after) <> 'null' then
    if jsonb_typeof(p_after) <> 'object'
       or jsonb_typeof(p_after -> 'day') is distinct from 'string'
       or jsonb_typeof(p_after -> 'at') is distinct from 'string'
       or jsonb_typeof(p_after -> 'entry') is distinct from 'string' then
      raise exception 'after_invalid' using errcode = '22023';
    end if;
    begin
      v_day := (p_after ->> 'day')::date;
      v_at := (p_after ->> 'at')::timestamptz;
      v_entry := (p_after ->> 'entry')::uuid;
    exception when others then
      raise exception 'after_invalid' using errcode = '22023';
    end;
  end if;

  -- Her profile's two questions, in its order: nobody she cannot see, and no finished read while her
  -- *Finished* switch is off (null, as member_want answers with Want to read off).
  if not private.visible(v_caller, p_member) then
    return null;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_finished then
    return null;
  end if;

  with closed as (
    select e.id as entry_id, e.book_id, s.id as session_id, s.ended_on, s.created_at,
           s.rating, s.review, s.review_spoilers
      from public.library_entries e
      join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
     where e.member_id = p_member and not e.hidden
  ), latest as (
    -- One row per entry: her latest finished read of it, as `member_profile` has it.
    select distinct on (c.entry_id) c.*
      from closed c
     order by c.entry_id, c.ended_on desc nulls last, c.created_at desc
  ), keyed as (
    -- The sort key as one value, so the keyset compares a single day (a read with no end date sorts last,
    -- the sentinel is the earliest day there is).
    select l.*, coalesce(l.ended_on, date '0001-01-01') as dk
      from latest l
  ), page as (
    select k.*, row_number() over (order by k.dk desc, k.created_at desc, k.entry_id) as n
      from keyed k
     where v_day is null
        or k.dk < v_day
        or (k.dk = v_day and (k.created_at < v_at or (k.created_at = v_at and k.entry_id > v_entry)))
     order by k.dk desc, k.created_at desc, k.entry_id
     limit v_limit + 1
  )
  select jsonb_build_object(
           'total', (select count(*) from keyed),
           'items', coalesce((select jsonb_agg(
                        jsonb_build_object(
                          'book', private.social_book_json(b),
                          'endedOn', g.ended_on,
                          'rating', case when v_s.show_ratings then g.rating end,
                          'review', case when v_s.show_reviews then g.review end,
                          'sessionId', g.session_id,
                          'spoilers', (v_s.show_reviews and g.review is not null and g.review_spoilers),
                          'folded', (v_s.show_reviews and g.review is not null
                                     and private.review_folded(v_caller, p_member, g.book_id, g.review_spoilers)),
                          'likes', private.like_count(g.session_id),
                          'liked', private.liked_by(v_caller, g.session_id)
                        ) order by g.n)
                      from page g
                      join public.books b on b.id = g.book_id
                     where g.n <= v_limit), '[]'::jsonb),
           'next', (select jsonb_build_object('day', g.dk::text, 'at', g.created_at, 'entry', g.entry_id)
                      from page g
                     where g.n = v_limit and exists (select 1 from page h where h.n > v_limit))
         )
    into v_result;

  return v_result;
end;
$function$
;
