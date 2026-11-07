CREATE OR REPLACE FUNCTION public.owner_set_chapter_count(p_room uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_parts  integer;
  v_used   integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  if p_count is null or p_count not between 1 and 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.notes_lock('notes_room', p_room::text);
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';
  select coalesce(max(s.position), 0)::integer into v_used
    from public.room_messages m
    join public.room_sections s on s.id = m.section_id
   where s.room_id = p_room and s.kind = 'part';
  if p_count < v_used then
    raise exception 'chapter_has_notes' using errcode = 'PT409';
  end if;

  if p_count > v_parts then
    update public.room_sections set position = (p_count + 1)::smallint where room_id = p_room and kind = 'end';
    insert into public.room_sections (room_id, position, kind)
    select p_room, k::smallint, 'part' from generate_series(v_parts + 1, p_count) k;
  elsif p_count < v_parts then
    delete from public.room_sections where room_id = p_room and kind = 'part' and position > p_count;
    update public.room_sections set position = (p_count + 1)::smallint where room_id = p_room and kind = 'end';
  end if;
  if p_count <> v_parts then
    insert into private.note_moderation_log (action, room_id, removed_by, reason)
    values ('chapter_count', p_room, v_caller, format('chapters %s -> %s', v_parts, p_count));
  end if;

  return jsonb_build_object('chapterCount', p_count, 'was', v_parts);
end;
$function$
;
