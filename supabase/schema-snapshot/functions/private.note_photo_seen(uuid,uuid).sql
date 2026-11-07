CREATE OR REPLACE FUNCTION private.note_photo_seen(p_caller uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_caller is not null and p_owner is not null
     and private.notes_public_enabled()
     and not private.blocked_either(p_caller, p_owner)
     and exists (select 1 from public.room_messages m
                  where m.author_id = p_owner and m.visibility = 'public' and m.deleted_at is null
                    and private.can_see_note(p_caller, m.id))
$function$
;
