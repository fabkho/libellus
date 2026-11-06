CREATE OR REPLACE FUNCTION private.room_sections_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_room uuid := coalesce(new.room_id, old.room_id);
begin
  if exists (select 1 from public.rooms r where r.id = v_room)
     and exists (select 1 from public.room_sections s where s.room_id = v_room)
     and not (select count(*) = max(s.position)
                     and count(*) filter (where s.kind = 'end') = 1
                     and max(s.position) filter (where s.kind = 'end') = max(s.position)
                from public.room_sections s where s.room_id = v_room) then
    raise exception 'room_sections_invalid: positions 1..n, one end, last' using errcode = '23514';
  end if;
  return null;
end;
$function$
;
