CREATE OR REPLACE FUNCTION public.create_buddy_read(p_book uuid, p_client_id uuid, p_sections jsonb, p_invite uuid[] DEFAULT '{}'::uuid[], p_link boolean DEFAULT false, p_starts date DEFAULT NULL::date, p_from text DEFAULT 'count'::text, p_page_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_read    public.buddy_reads;
  v_book    public.books;
  v_entry   uuid;
  v_invites jsonb := jsonb_build_object('invited', '[]'::jsonb, 'skipped', '[]'::jsonb);
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- The same call again: the read it made, whatever became of it since.
  select * into v_read from public.buddy_reads where host_id = v_caller and client_id = p_client_id;
  if found then
    return jsonb_build_object('id', v_read.id, 'link_token', v_read.link_token,
                              'invited', '[]'::jsonb, 'skipped', '[]'::jsonb);
  end if;

  select * into v_book from public.books where id = p_book;
  select e.id into v_entry from public.library_entries e where e.member_id = v_caller and e.book_id = p_book;
  if v_book.id is null or v_book.owner_id is not null or v_book.source = 'manual' or v_book.check_failed
     or v_entry is null then
    raise exception 'buddy_book_invalid' using errcode = '22023';
  end if;
  if p_starts is not null and p_starts not between current_date - 366 and current_date + 366 then
    raise exception 'buddy_starts_invalid' using errcode = '22023';
  end if;
  perform 1 from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count);

  select r.* into v_read
    from public.buddy_reads r
    join public.buddy_read_members h on h.buddy_read_id = r.id and h.member_id = v_caller and h.role = 'host'
   where r.book_id = p_book and r.status = 'active';
  if found then
    raise exception 'buddy_read_exists' using errcode = 'PT409', detail = v_read.id::text;
  end if;

  perform private.buddy_rate(v_caller, 'create', 20);
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;

  insert into public.buddy_reads (book_id, host_id, starts_on, link_token, sections_from, page_count, client_id)
  values (p_book, v_caller, coalesce(p_starts, current_date),
          case when coalesce(p_link, false) then private.reading_page_token() end,
          coalesce(p_from, 'count'), p_page_count, p_client_id)
  returning * into v_read;

  insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at, entry_id)
  values (v_read.id, v_caller, 'host', clock_timestamp(), v_entry);

  insert into public.buddy_read_sections (buddy_read_id, position, kind, label, start_page, end_page, to_fraction)
  select v_read.id, s.s_position, s.s_kind, s.s_label, s.s_start_page, s.s_end_page, s.s_to_fraction
    from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count) s;

  if cardinality(coalesce(p_invite, '{}')) > 0 then
    perform private.buddy_lock_read(v_read.id);
    v_invites := private.buddy_invite(v_read.id, v_caller, p_invite);
  end if;

  return jsonb_build_object('id', v_read.id, 'link_token', v_read.link_token)
         || jsonb_build_object('invited', v_invites -> 'invited', 'skipped', v_invites -> 'skipped');
end;
$function$
;
