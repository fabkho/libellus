CREATE OR REPLACE FUNCTION private.note_quote(p_viewer uuid, p_parent uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
           when m.id is null then null
           when not private.can_see_note(p_viewer, m.id) then jsonb_build_object('hidden', true)
           when m.deleted_at is not null then jsonb_build_object('removed', true)
           else jsonb_build_object('id', m.id,
                                   'author', private.member_card(p_viewer, m.author_id),
                                   'excerpt', left(m.body, 140),
                                   'spoiler', m.spoiler,
                                   'voice', m.voice_object is not null)
         end
    from (select 1) one
    left join public.room_messages m on m.id = p_parent
$function$
;
