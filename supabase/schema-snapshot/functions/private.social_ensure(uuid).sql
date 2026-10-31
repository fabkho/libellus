CREATE OR REPLACE FUNCTION private.social_ensure(p_member uuid)
 RETURNS social_settings
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_row public.social_settings;
begin
  insert into public.social_settings (member_id, follow_token)
  values (p_member, private.reading_page_token())
  on conflict (member_id) do nothing;
  select * into v_row from public.social_settings where member_id = p_member;
  return v_row;
end;
$function$
;
