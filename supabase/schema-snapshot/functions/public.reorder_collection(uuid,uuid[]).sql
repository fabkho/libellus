CREATE OR REPLACE FUNCTION public.reorder_collection(p_collection uuid, p_entries uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  if p_entries is null
     or array_position(p_entries, null) is not null
     or cardinality(p_entries) <> (select count(distinct x) from unnest(p_entries) x)
     or cardinality(p_entries) <> (select count(*) from public.collection_entries
                                    where collection_id = v_collection.id)
     or exists (select 1 from unnest(p_entries) x
                 where not exists (select 1 from public.collection_entries
                                    where collection_id = v_collection.id and entry_id = x)) then
    raise exception 'order_mismatch' using errcode = '22023';
  end if;

  update public.collection_entries ce
     set position = o.n
    from unnest(p_entries) with ordinality as o(entry_id, n)
   where ce.collection_id = v_collection.id and ce.entry_id = o.entry_id;
end;
$function$
;
