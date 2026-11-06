CREATE OR REPLACE FUNCTION public.add_book_chapters(p_room uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_room   public.rooms;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_room from public.rooms r where r.id = p_room and r.kind = 'notes';
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if not private.has_work(v_caller, v_room.work_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;
  if p_count is null or p_count < 1 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;

  perform private.notes_lock('notes_room', p_room::text);
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';
  if v_parts + p_count > 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  perform private.note_rate(v_caller, 'chapters', 20, interval '1 day');

  update public.room_sections set position = (v_parts + p_count + 1)::smallint
   where room_id = p_room and kind = 'end';
  insert into public.room_sections (room_id, position, kind)
  select p_room, k::smallint, 'part' from generate_series(v_parts + 1, v_parts + p_count) k;

  return private.notes_page(v_caller, v_room.work_key, p_room);
end;
$function$
;
