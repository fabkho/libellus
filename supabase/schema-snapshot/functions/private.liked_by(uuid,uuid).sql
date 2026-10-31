CREATE OR REPLACE FUNCTION private.liked_by(p_member uuid, p_session uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select p_member is not null
     and exists (select 1 from public.likes where member_id = p_member and session_id = p_session)
$function$
;
