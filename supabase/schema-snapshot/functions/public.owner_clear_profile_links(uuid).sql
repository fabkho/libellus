CREATE OR REPLACE FUNCTION public.owner_clear_profile_links(p_member uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_removed integer;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  delete from public.profile_links where member_id = p_member;
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$function$
;
