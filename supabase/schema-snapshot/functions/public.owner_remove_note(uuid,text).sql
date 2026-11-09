CREATE OR REPLACE FUNCTION public.owner_remove_note(p_note uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\n\r'), '');
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) > 1000 then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes'
   for update of m;
  if not found or v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  insert into private.note_moderation_log (message_id, room_id, author_id, removed_by, reason, body, visibility)
  values (v_row.id, v_row.room_id, v_row.author_id, v_caller, v_reason,
          case when v_row.kind = 'voice' then '[voice note, ' || round(v_row.voice_duration_ms / 1000.0)::integer || ' s]' else v_row.body end,
          v_row.visibility);
  delete from public.room_reactions where message_id = p_note;
  update public.room_messages
     set body = '', voice_object = null, voice_mime = null, voice_duration_ms = null, voice_peaks = null,
         deleted_at = clock_timestamp(), deleted_by = v_caller, moderated = true
   where id = p_note;
  return jsonb_build_object('removed', true);
end;
$function$
;
