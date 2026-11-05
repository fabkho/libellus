CREATE OR REPLACE FUNCTION private.buddy_gate(p_read uuid, p_member uuid)
 RETURNS buddy_read_members
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.buddy_read_members;
begin
  select * into v_row from public.buddy_read_members
   where buddy_read_id = p_read and member_id = p_member and joined_at is not null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  return v_row;
end;
$function$
;
