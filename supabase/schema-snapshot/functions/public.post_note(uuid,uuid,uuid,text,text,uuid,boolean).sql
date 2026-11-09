CREATE OR REPLACE FUNCTION public.post_note(p_room uuid, p_section uuid, p_client_id uuid, p_body text, p_visibility text, p_reply_to uuid DEFAULT NULL::uuid, p_spoiler boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_row    public.room_messages;
  v_parent public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;
  if p_visibility is null or p_visibility not in ('private', 'friends', 'public') then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  if p_body is null or p_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
    raise exception 'body_empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  perform private.notes_lock('notes', v_caller::text);

  -- A retry: the note it made (as she sees it now). A voice note's client id is not a text's: post_note never answers (or makes) one.
  select * into v_row from public.room_messages m where m.author_id = v_caller and m.client_id = p_client_id;
  if found then
    if v_row.room_id is distinct from p_room or v_row.section_id is distinct from p_section or v_row.kind <> 'text' then
      raise exception 'client_id_reused' using errcode = 'PT409';
    end if;
    return private.note_json(v_caller, v_row);
  end if;

  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;
  if p_visibility = 'public' and not private.notes_public_enabled() then
    raise exception 'notes_public_off' using errcode = 'PT409';
  end if;

  -- The room's lock: the chapter, the parent's level and the thread's newest time are read after it.
  perform private.notes_lock('notes_room', p_room::text);
  if not exists (select 1 from public.room_sections s where s.id = p_section and s.room_id = p_room) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if p_reply_to is not null then
    select * into v_parent from public.room_messages m where m.id = p_reply_to;
    if not found or v_parent.room_id <> p_room or v_parent.section_id is distinct from p_section
       or v_parent.deleted_at is not null or not private.can_see_note(v_caller, v_parent.id) then
      raise exception 'reply_not_visible' using errcode = '22023';
    end if;
    if private.note_level(p_visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
  end if;

  -- 30 a minute and 300 a day over all Books. Under her member lock.
  if (select count(*) from public.room_messages m
       where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.room_messages m
          where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  -- Every move to Everyone is one use of her 30 a day (a post here, a widening in set_note_visibility).
  if p_visibility = 'public' then
    perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
  end if;

  insert into public.room_messages (room_id, section_id, author_id, client_id, body, reply_to, spoiler,
                                    visibility, created_at)
  values (p_room, p_section, v_caller, p_client_id, p_body, p_reply_to, coalesce(p_spoiler, false),
          p_visibility,
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.room_messages m where m.section_id = p_section)))
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$function$
;
