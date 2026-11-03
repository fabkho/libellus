CREATE OR REPLACE FUNCTION public.my_buddy_reads()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'reads', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'status', r.status,
               'starts_on', r.starts_on,
               'role', m.role,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id),
               'where', private.buddy_where(m, private.buddy_parts(r.id)),
               'unread', private.buddy_unread(r.id, v_caller)
             ) order by (r.status = 'active') desc, r.starts_on desc, r.created_at desc, r.id)
        from public.buddy_read_members m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
       where m.member_id = v_caller and m.joined_at is not null
         and (r.status = 'active'
              or r.id in (select e.id
                            from public.buddy_read_members em
                            join public.buddy_reads e on e.id = em.buddy_read_id
                           where em.member_id = v_caller and em.joined_at is not null and e.status <> 'active'
                           order by coalesce(e.archived_at, e.finished_at) desc nulls last, e.id
                           limit 20))
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id,
               'book', private.social_book_json(b),
               'starts_on', r.starts_on,
               'host', (select private.member_card(v_caller, h.member_id) from public.buddy_read_members h
                         where h.buddy_read_id = r.id and h.role = 'host'),
               'invited_by', case when m.invited_by is not null then private.member_card(v_caller, m.invited_by) end,
               'member_count', (select count(*) from public.buddy_read_members x
                                 where x.buddy_read_id = r.id and x.joined_at is not null),
               'sections', private.buddy_parts(r.id)
             ) order by m.invited_at desc, r.id)
        from (select m0.*
                from public.buddy_read_members m0
                join public.buddy_reads r0 on r0.id = m0.buddy_read_id
               where m0.member_id = v_caller and m0.joined_at is null and r0.status = 'active'
                 and not exists (select 1 from public.buddy_read_members x
                                  where x.buddy_read_id = r0.id and x.member_id <> v_caller
                                    and private.blocked_either(x.member_id, v_caller))
               order by m0.invited_at desc, r0.id
               limit 50) m
        join public.buddy_reads r on r.id = m.buddy_read_id
        join public.books b on b.id = r.book_id
    ), '[]'::jsonb)
  );
end;
$function$
;
