CREATE OR REPLACE FUNCTION private.visible_notes(p_viewer uuid, p_room uuid)
 RETURNS SETOF room_messages
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with s as (
    select coalesce((select x.public_enabled from private.notes_settings x where x.id), false) as public_on
  )
  select m.*
    from public.room_messages m
    join public.rooms r on r.id = m.room_id and r.kind = 'notes'
    cross join s
   where m.room_id = p_room
     and p_viewer is not null
     and (m.author_id = p_viewer
          or (not exists (select 1 from public.blocks b
                           where (b.blocker_id = p_viewer and b.blocked_id = m.author_id)
                              or (b.blocker_id = m.author_id and b.blocked_id = p_viewer))
              and ((m.visibility = 'public' and s.public_on)
                   or (m.visibility in ('friends', 'public')
                       and exists (select 1 from public.follows f
                                    where f.follower_id = p_viewer and f.followee_id = m.author_id
                                      and f.accepted_at is not null)
                       and exists (select 1 from public.follows f
                                    where f.follower_id = m.author_id and f.followee_id = p_viewer
                                      and f.accepted_at is not null)))))
$function$
;
