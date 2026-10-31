CREATE OR REPLACE FUNCTION public.both_read(p_member uuid, p_year integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
  v_s      public.social_settings;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if private.visible(v_caller, p_member) is not true then
    return '[]'::jsonb;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_finished or not v_s.show_year then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'book', private.social_book_json(b),
             'mine', jsonb_build_object('rating', m.rating, 'endedOn', m.ended_on),
             'hers', jsonb_build_object('rating', case when v_s.show_ratings then h.rating end,
                                        'endedOn', h.ended_on))
           order by h.ended_on desc nulls last, h.created_at desc, b.id), '[]'::jsonb)
      from (
        select distinct on (e.id) e.book_id, s.rating, s.ended_on, s.created_at
          from public.library_entries e
          join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
         where e.member_id = p_member and not e.hidden
           and (p_year is null or extract(year from s.ended_on) = p_year)
         order by e.id, s.ended_on desc nulls last, s.created_at desc
      ) h
      join public.books b on b.id = h.book_id
      cross join lateral (
        select s2.rating, s2.ended_on
          from public.library_entries e2
          join public.reading_sessions s2 on s2.entry_id = e2.id and s2.outcome = 'finished'
          join public.books b2 on b2.id = e2.book_id
         where e2.member_id = v_caller
           and (b2.id = b.id
                or (b.openlibrary_work_key is not null and b2.openlibrary_work_key = b.openlibrary_work_key))
         order by s2.ended_on desc nulls last, s2.created_at desc
         limit 1
      ) m
  );
end;
$function$
;
