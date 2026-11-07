CREATE OR REPLACE FUNCTION public.set_note_visibility(p_note uuid, p_visibility text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
  v_parent text;
  v_level  integer := private.note_level(p_visibility);
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_level is null then
    raise exception 'invalid_visibility' using errcode = '22023';
  end if;
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller and m.deleted_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.notes_lock('notes_room', v_row.room_id::text);
  select m.* into v_row from public.room_messages m where m.id = p_note for update;
  if v_row.deleted_at is not null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if v_level < private.note_level(v_row.visibility) then
    -- Narrowing: the replies first (each to the narrower of its level and the new one), then the note.
    with recursive d as (
      select m.id from public.room_messages m where m.reply_to = p_note
      union
      select m.id from public.room_messages m join d on m.reply_to = d.id
    )
    update public.room_messages m set visibility = p_visibility
      from d
     where m.id = d.id and private.note_level(m.visibility) > v_level;
  elsif v_level > private.note_level(v_row.visibility) then
    if p_visibility = 'public' and not private.notes_public_enabled() then
      raise exception 'notes_public_off' using errcode = 'PT409';
    end if;
    select p.visibility into v_parent from public.room_messages p where p.id = v_row.reply_to;
    if v_parent is not null and v_level > private.note_level(v_parent) then
      raise exception 'note_wider_than_parent' using errcode = '22023';
    end if;
    -- Every move to Everyone is one use of her 30 a day, whenever the note was written: narrowing and
    -- widening again uses another.
    if p_visibility = 'public' then
      perform private.note_rate(v_caller, 'public', 30, interval '24 hours');
    end if;
  end if;

  update public.room_messages set visibility = p_visibility where id = p_note and visibility <> p_visibility
  returning * into v_row;
  if not found then
    select * into v_row from public.room_messages m where m.id = p_note;
  end if;
  return private.note_json(v_caller, v_row);
end;
$function$
;
