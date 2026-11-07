CREATE OR REPLACE FUNCTION public.set_note_chapter(p_room uuid, p_chapter integer, p_finished boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.rooms r where r.id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  if coalesce(p_finished, false) then
    insert into public.note_positions as p (room_id, member_id, hand_chapter, hand_finished, updated_at)
    values (p_room, v_caller, null, true, now())
    on conflict (room_id, member_id) do update set hand_chapter = null, hand_finished = true, updated_at = now();
  elsif p_chapter is null then
    delete from public.note_positions where room_id = p_room and member_id = v_caller;
  elsif p_chapter between 1 and v_parts then
    insert into public.note_positions as p (room_id, member_id, hand_chapter, hand_finished, updated_at)
    values (p_room, v_caller, p_chapter::smallint, false, now())
    on conflict (room_id, member_id) do update set hand_chapter = excluded.hand_chapter, hand_finished = false,
                                                  updated_at = now();
  else
    raise exception 'invalid_chapter' using errcode = '22023';
  end if;

  return private.note_chapter(v_caller, p_room);
end;
$function$
;
