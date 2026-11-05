CREATE OR REPLACE FUNCTION public.buddy_read_target(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_mine   public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;

  select * into v_read from public.buddy_reads where link_token = p_token;
  if not found or v_read.status <> 'active'
     or exists (select 1 from public.buddy_read_members x
                 where x.buddy_read_id = v_read.id and x.member_id <> v_caller
                   and private.blocked_either(x.member_id, v_caller))
     or exists (select 1 from private.buddy_read_removed d
                 where d.buddy_read_id = v_read.id and d.member_id = v_caller) then
    return null;
  end if;
  select * into v_mine from public.buddy_read_members where buddy_read_id = v_read.id and member_id = v_caller;
  if v_mine.member_id is null
     and (select count(*) from public.buddy_read_members where buddy_read_id = v_read.id) >= 12 then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_read.id,
    'book', (select private.social_book_json(b) from public.books b where b.id = v_read.book_id),
    'host', (select private.member_card(v_caller, h.member_id) from public.buddy_read_members h
              where h.buddy_read_id = v_read.id and h.role = 'host'),
    'members', coalesce((
      select jsonb_agg(private.member_card(v_caller, m.member_id) order by (m.role = 'host') desc, m.joined_at, m.member_id)
        from public.buddy_read_members m
       where m.buddy_read_id = v_read.id and m.joined_at is not null
    ), '[]'::jsonb),
    'member_count', (select count(*) from public.buddy_read_members m
                      where m.buddy_read_id = v_read.id and m.joined_at is not null),
    'sections', private.buddy_parts(v_read.id),
    'starts_on', v_read.starts_on,
    'state', case when v_mine.member_id is null then 'none'
                  when v_mine.joined_at is null then 'invited'
                  else 'member' end
  );
end;
$function$
;
