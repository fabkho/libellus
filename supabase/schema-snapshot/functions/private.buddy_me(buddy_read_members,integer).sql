CREATE OR REPLACE FUNCTION private.buddy_me(p_member buddy_read_members, p_parts integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select jsonb_build_object(
    'entry_id', p_member.entry_id,
    'auto', p_member.auto_through,
    'hand', p_member.hand_through,
    'read_through', p_member.read_through,
    'where', private.buddy_where(p_member, p_parts)
  )
$function$
;
