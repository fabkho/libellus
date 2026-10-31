CREATE OR REPLACE FUNCTION private.circle_of(p_caller uuid, p_books uuid[], p_reading boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with mine as (
    select distinct b.id as book_id, b.openlibrary_work_key as wk
      from unnest((coalesce(p_books, '{}'::uuid[]))[1:50]) as u(id)
      join public.books b on b.id = u.id
      join public.library_entries e on e.book_id = b.id and e.member_id = p_caller
     where case when p_reading
                then exists (select 1 from public.reading_sessions s where s.entry_id = e.id and s.outcome is null)
                else e.status = 'want_to_read' end
  ), hers as (
    select distinct on (m.book_id, e.member_id) m.book_id, e.member_id, e.added_at, e.id as entry_id
      from mine m
      join public.books b2 on b2.id = m.book_id
                          or (m.wk is not null and b2.openlibrary_work_key = m.wk)
      join public.library_entries e on e.book_id = b2.id and not e.hidden and e.member_id <> p_caller
      join public.follows f on f.follower_id = p_caller and f.followee_id = e.member_id
                           and f.accepted_at is not null
      left join public.social_settings st on st.member_id = e.member_id
     where case when p_reading
                then coalesce(st.show_reading, true)
                     and exists (select 1 from public.reading_sessions s where s.entry_id = e.id and s.outcome is null)
                else coalesce(st.show_want, true) and e.status = 'want_to_read' end
       and not private.blocked_either(p_caller, e.member_id)
     order by m.book_id, e.member_id, e.added_at desc, e.id
  ), ranked as (
    select h.book_id, h.member_id,
           row_number() over (partition by h.book_id order by h.added_at desc, h.entry_id, h.member_id) as rn,
           count(*) over (partition by h.book_id) as total
      from hers h
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'book', g.book_id, 'members', g.members, 'more', greatest(g.total - 3, 0)
         ) order by g.book_id), '[]'::jsonb)
    from (
      select r.book_id, max(r.total)::integer as total,
             jsonb_agg(private.member_card(p_caller, r.member_id) order by r.rn) filter (where r.rn <= 3) as members
        from ranked r
       group by r.book_id
    ) g
$function$
;
