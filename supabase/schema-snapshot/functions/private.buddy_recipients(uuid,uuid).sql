CREATE OR REPLACE FUNCTION private.buddy_recipients(p_read uuid, p_actor uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select m.member_id
    from public.buddy_read_members m
   where m.buddy_read_id = p_read
     and m.joined_at is not null
     and (p_actor is null or not private.buddy_hidden(m.member_id, p_actor))
  union
  select p_actor
   where p_actor is not null
     and exists (select 1 from auth.users u where u.id = p_actor)
$function$
;
