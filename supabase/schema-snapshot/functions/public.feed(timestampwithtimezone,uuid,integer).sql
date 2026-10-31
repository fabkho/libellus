CREATE OR REPLACE FUNCTION public.feed(p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
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
             'review', t.review,
             'sessionId', case when t.kind in ('finished', 'reviewed') then t.session_id end,
             'spoilers', coalesce(t.review is not null and t.review_spoilers, false),
             'folded', coalesce(t.review is not null
                                and private.review_folded(v_caller, t.member_id, t.book_id, t.review_spoilers), false),
             'likes', case when t.kind in ('finished', 'reviewed') then private.like_count(t.session_id) else 0 end,
             'liked', case when t.kind in ('finished', 'reviewed')
                           then private.liked_by(v_caller, t.session_id) else false end
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
             e.book_id, a.session_id, rs.review_spoilers
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
$function$
;
