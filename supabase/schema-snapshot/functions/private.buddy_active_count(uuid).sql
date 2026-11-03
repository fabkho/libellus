CREATE OR REPLACE FUNCTION private.buddy_active_count(p_member uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select count(*)::integer
    from public.buddy_read_members m
    join public.buddy_reads r on r.id = m.buddy_read_id
   where m.member_id = p_member and m.joined_at is not null and r.status = 'active'
$function$
;
