CREATE OR REPLACE FUNCTION private.social_of(p_member uuid)
 RETURNS social_settings
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.social_settings;
begin
  select * into v_row from public.social_settings where member_id = p_member;
  if not found then
    v_row := row(p_member, true, true, true, true, true, true, true, true, null, now())::public.social_settings;
  end if;
  return v_row;
end;
$function$
;
