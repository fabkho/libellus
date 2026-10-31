CREATE OR REPLACE FUNCTION public.create_collection(p_name text)
 RETURNS collections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member     uuid := auth.uid();
  v_name       text := public.collection_name(p_name);
  v_collection public.collections;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  -- One member's creates queue up, so two never get the same position.
  perform pg_advisory_xact_lock(hashtext('collections:' || v_member::text));
  begin
    insert into public.collections (member_id, name, position)
    values (
      v_member, v_name,
      coalesce((select max(position) from public.collections where member_id = v_member), 0) + 1
    )
    returning * into v_collection;
  exception when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  end;
  return v_collection;
end;
$function$
;
