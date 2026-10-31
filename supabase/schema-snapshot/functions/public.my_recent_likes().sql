CREATE OR REPLACE FUNCTION public.my_recent_likes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'session', g.session_id,
             'book', private.social_book_json(b),
             'likers', (select coalesce(jsonb_agg(private.member_card(v_caller, x.member_id)
                                                  order by x.created_at desc, x.member_id), '[]'::jsonb)
                          from (select l2.member_id, l2.created_at
                                  from private.allowed_likes(g.session_id) l2
                                 order by l2.created_at desc, l2.member_id
                                 limit 3) x),
             'count', g.cnt,
             'at', g.at) order by g.at desc, g.session_id), '[]'::jsonb)
      from (
        select c.session_id, c.book_id, max(a.created_at) as at, count(*)::integer as cnt
          from (
            -- Her finished reads, not hidden, with a like in the last week: cut before anything is
            -- asked of the likers.
            select s.id as session_id, e.book_id
              from public.reading_sessions s
              join public.library_entries e on e.id = s.entry_id and e.member_id = v_caller and not e.hidden
             where s.outcome = 'finished'
               and exists (select 1 from public.likes l
                            where l.session_id = s.id and l.created_at > now() - interval '7 days')
          ) c
          cross join lateral private.allowed_likes(c.session_id) a
         group by c.session_id, c.book_id
        having max(a.created_at) > now() - interval '7 days'
         order by max(a.created_at) desc, c.session_id
         limit 5
      ) g
      join public.books b on b.id = g.book_id
  );
end;
$function$
;
