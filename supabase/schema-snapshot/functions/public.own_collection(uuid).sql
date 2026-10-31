CREATE OR REPLACE FUNCTION public.own_collection(p_collection uuid)
 RETURNS collections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member     uuid := auth.uid();
  v_collection public.collections;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select * into v_collection from public.collections
   where id = p_collection and member_id = v_member
   for update;
  if not found then
    raise exception 'collection_missing' using errcode = 'P0002';
  end if;
  return v_collection;
end;
$function$
;
