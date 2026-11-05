CREATE OR REPLACE FUNCTION private.buddy_where(p_member buddy_read_members, p_parts integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select case
    when p_member.entry_id is null and p_member.hand_through is null and p_member.auto_through is null
      then jsonb_build_object('kind', 'not_set')
    when p_member.read_through >= p_parts
      then jsonb_build_object('kind', 'end')
    else jsonb_build_object('kind', 'section', 'section', p_member.read_through + 1)
  end
$function$
;
