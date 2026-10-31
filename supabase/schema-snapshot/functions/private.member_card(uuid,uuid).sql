CREATE OR REPLACE FUNCTION private.member_card(p_caller uuid, p_owner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select jsonb_build_object(
    'id', p_owner,
    'name', private.member_name(p_owner),
    'photo', case when private.can_see_photo(p_caller, p_owner)
                  then (select a.avatar_path from public.accounts a where a.id = p_owner) end
  )
$function$
;
