CREATE OR REPLACE FUNCTION public.can_see_member_file(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_folder text;
  v_path   text;
begin
  if p_name is null
     or p_name !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}(-128)?\.(webp|jpg)$' then
    return false;
  end if;
  v_folder := split_part(p_name, '/', 1);
  if not public.can_see_member_folder(v_folder) then
    return false;
  end if;
  select a.avatar_path into v_path from public.accounts a where a.id = v_folder::uuid;
  return v_path is not null
     and (p_name = v_path
          or p_name = regexp_replace(v_path, '\.(webp|jpg)$', '-128.\1'));
end;
$function$
;
