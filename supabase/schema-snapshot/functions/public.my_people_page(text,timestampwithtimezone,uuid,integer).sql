CREATE OR REPLACE FUNCTION public.my_people_page(p_list text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_list is null or p_list not in ('following', 'followers') then
    raise exception 'people_list_invalid' using errcode = '22023';
  end if;
  return private.people_page(v_caller, p_list, p_before, p_before_id,
                             least(greatest(coalesce(p_limit, 30), 1), 50));
end;
$function$
;
