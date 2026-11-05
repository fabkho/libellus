CREATE OR REPLACE FUNCTION public.buddy_read(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
  v_read   public.buddy_reads;
  v_parts  integer;
  v_host   boolean;
  v_counts jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_me := private.buddy_gate(p_id, v_caller);
  select * into v_read from public.buddy_reads where id = p_id;
  v_parts := private.buddy_parts(p_id);
  v_host := v_me.role = 'host';
  select coalesce(jsonb_object_agg(coalesce(c.section_id::text, 'room'),
                                   jsonb_build_object('count', c.total, 'unread', c.unread)), '{}'::jsonb)
    into v_counts
    from private.buddy_counts(p_id, v_caller) c;

  return jsonb_build_object(
    'id', v_read.id,
    'book', (select private.social_book_json(b) from public.books b where b.id = v_read.book_id),
    'status', v_read.status,
    'starts_on', v_read.starts_on,
    'finished_at', v_read.finished_at,
    'archived_at', v_read.archived_at,
    'sections_from', v_read.sections_from,
    'page_count', v_read.page_count,
    'role', v_me.role,
    'can_manage', v_host,
    'room', coalesce(v_counts -> 'room', jsonb_build_object('count', 0, 'unread', 0)),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'position', s.position, 'kind', s.kind, 'label', s.label,
               'start_page', s.start_page, 'end_page', s.end_page, 'to_fraction', s.to_fraction,
               'count', coalesce((v_counts -> s.id::text ->> 'count')::integer, 0),
               'unread', coalesce((v_counts -> s.id::text ->> 'unread')::integer, 0)
             ) order by s.position)
        from public.buddy_read_sections s where s.buddy_read_id = p_id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(private.buddy_card(v_caller, m, v_parts)
                       order by (m.role = 'host') desc, m.joined_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is not null
    ), '[]'::jsonb),
    'me', private.buddy_me(v_me, v_parts),
    'link_token', case when v_host then v_read.link_token end,
    'invited', case when v_host then coalesce((
      select jsonb_agg(private.member_card(v_caller, m.member_id) order by m.invited_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = p_id and m.joined_at is null
    ), '[]'::jsonb) end
  );
end;
$function$
;
