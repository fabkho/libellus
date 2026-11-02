CREATE OR REPLACE FUNCTION private.buddy_member(p_read uuid, p_member uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p_read is not null and p_member is not null and exists (
    select 1 from public.buddy_read_members
     where buddy_read_id = p_read and member_id = p_member and joined_at is not null
  )
$function$
;
