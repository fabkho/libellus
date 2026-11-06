CREATE OR REPLACE FUNCTION private.can_see_note(p_viewer uuid, p_note uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((
    select case
             when p_viewer is null then false
             when r.kind <> 'notes' then false
             when m.author_id = p_viewer then true
             when private.blocked_either(p_viewer, m.author_id) then false
             when m.visibility = 'public' and private.notes_public_enabled() then true
             when m.visibility in ('friends', 'public') then private.mutual_friends(p_viewer, m.author_id)
             else false
           end
      from public.room_messages m
      join public.rooms r on r.id = m.room_id
     where m.id = p_note
  ), false)
$function$
;
