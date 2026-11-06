CREATE OR REPLACE FUNCTION private.note_author_seen(p_caller uuid, p_target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_caller is not null and p_target is not null and p_caller <> p_target
     and not private.blocked_either(p_caller, p_target)
     and exists (select 1 from public.room_messages m
                  where m.author_id = p_target and m.deleted_at is null
                    and private.can_see_note(p_caller, m.id))
$function$
;
