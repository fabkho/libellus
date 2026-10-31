CREATE OR REPLACE FUNCTION private.allowed_likes(p_session uuid)
 RETURNS SETOF likes
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with o as (
    select e.member_id as owner, so.private
      from public.reading_sessions s
      join public.library_entries e on e.id = s.entry_id and not e.hidden
      cross join lateral private.social_of(e.member_id) so
     where s.id = p_session and s.outcome = 'finished' and so.show_finished
  )
  select l.*
    from public.likes l
    cross join o
   where l.session_id = p_session
     and l.member_id <> o.owner
     and not exists (select 1 from public.blocks b
                      where (b.blocker_id = l.member_id and b.blocked_id = o.owner)
                         or (b.blocker_id = o.owner and b.blocked_id = l.member_id))
     and (not o.private
          or exists (select 1 from public.follows f
                      where f.follower_id = l.member_id and f.followee_id = o.owner and f.accepted_at is not null))
$function$
;
