CREATE OR REPLACE FUNCTION private.buddy_card(p_caller uuid, p_member buddy_read_members, p_parts integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.member_card(p_caller, p_member.member_id)
         || jsonb_build_object(
              'role', p_member.role,
              'where', case when p_member.member_id <> p_caller and private.blocked_either(p_caller, p_member.member_id)
                            then null
                            else private.buddy_where(p_member, p_parts) end)
$function$
;
