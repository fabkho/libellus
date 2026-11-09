CREATE OR REPLACE FUNCTION public.post_note_voice(p_room uuid, p_section uuid, p_client_id uuid, p_object text, p_mime text, p_duration_ms integer, p_peaks integer[], p_reply_to uuid DEFAULT NULL::uuid)
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
  v_path   text;
  v_object jsonb;
  v_size   bigint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'client_id_required' using errcode = '22023';
  end if;
  if private.buddy_voice_ext(p_mime) is null
     or p_duration_ms is null or p_duration_ms not between 1 and 120000
     or (p_peaks is not null and (array_ndims(p_peaks) <> 1
                                  or cardinality(p_peaks) not between 1 and 48
                                  or array_position(p_peaks, null) is not null
                                  or 0 > any (p_peaks) or 100 < any (p_peaks))) then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  perform private.notes_lock('notes', v_caller::text);

  -- A retry: the note it made (as she sees it now), before the gate.
  select * into v_row from public.room_messages m where m.author_id = v_caller and m.client_id = p_client_id;
  if found then
    if v_row.room_id is distinct from p_room or v_row.section_id is distinct from p_section or v_row.kind <> 'voice' then
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

  -- The room's lock: the chapter, the parent and the thread's newest time are read after it.
  perform private.notes_lock('notes_room', p_room::text);
  if not exists (select 1 from public.room_sections s where s.id = p_section and s.room_id = p_room) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- The name is hers, in this room, for this client id and type: never another member's object.
  v_path := private.note_voice_path(p_room, v_caller, p_client_id, p_mime);
  if p_object is distinct from v_path then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  -- A reply: only to her own live private note of the same chapter.
  if p_reply_to is not null then
    select * into v_parent from public.room_messages m where m.id = p_reply_to;
    if not found or v_parent.room_id <> p_room or v_parent.section_id is distinct from p_section
       or v_parent.deleted_at is not null or v_parent.author_id <> v_caller or v_parent.visibility <> 'private' then
      raise exception 'reply_not_visible' using errcode = '22023';
    end if;
  end if;

  -- The object: there, of the type said, not empty, not over the bucket's 3 MB.
  select o.metadata into v_object from storage.objects o where o.bucket_id = 'note-voice' and o.name = v_path;
  if not found then
    raise exception 'voice_missing' using errcode = '22023';
  end if;
  -- The type Storage kept, without its parameters: a browser's recorder says "audio/webm;codecs=opus" and Storage keeps what it is sent.
  if lower(btrim(split_part(coalesce(v_object ->> 'mimetype', ''), ';', 1))) is distinct from p_mime then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;
  v_size := coalesce(nullif(v_object ->> 'size', '')::bigint, 0);
  if v_size > 3 * 1024 * 1024 then
    raise exception 'voice_too_large' using errcode = '22023';
  end if;
  if v_size < 1 then
    raise exception 'voice_invalid' using errcode = '22023';
  end if;

  -- 30 a minute and 300 a day over all Books, as post_note. Under her member lock.
  if (select count(*) from public.room_messages m
       where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.room_messages m
          where m.author_id = v_caller and m.created_at > clock_timestamp() - interval '1 day') >= 300 then
    raise exception 'rate_limited' using errcode = 'PT429';
  end if;
  -- And a voice note's own, which keeps the bucket small: 10 a minute, 100 a day.
  perform private.note_rate(v_caller, 'voice', 10, interval '1 minute');
  perform private.note_rate(v_caller, 'voice_day', 100, interval '1 day');

  insert into public.room_messages (room_id, section_id, author_id, client_id, kind, body, reply_to, visibility,
                                    voice_object, voice_mime, voice_duration_ms, voice_peaks, created_at)
  values (p_room, p_section, v_caller, p_client_id, 'voice', '', p_reply_to, 'private',
          v_path, p_mime, p_duration_ms, p_peaks::smallint[],
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.room_messages m where m.section_id = p_section)))
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$function$
;
