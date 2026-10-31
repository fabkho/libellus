CREATE OR REPLACE FUNCTION public.rename_collection(p_collection uuid, p_name text)
 RETURNS collections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection public.collections := public.own_collection(p_collection);
  v_name       text := public.collection_name(p_name);
begin
  if v_name is null then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  begin
    update public.collections set name = v_name where id = v_collection.id
    returning * into v_collection;
  exception when unique_violation then
    raise exception 'name_taken' using errcode = '23505';
  end;
  return v_collection;
end;
$function$
;
