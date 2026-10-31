CREATE OR REPLACE FUNCTION public.remove_from_collection(p_collection uuid, p_entry uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  delete from public.collection_entries
   where collection_id = v_collection.id and entry_id = p_entry;
  if not found then
    raise exception 'not_in_collection' using errcode = 'P0002';
  end if;
end;
$function$
;
