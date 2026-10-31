CREATE OR REPLACE FUNCTION public.import_place_in_collections(p_member uuid, p_entry uuid, p_names jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_value      jsonb;
  v_name       text;
  v_collection uuid;
begin
  if p_names is null or jsonb_typeof(p_names) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 50 then
    raise exception 'collections_invalid' using errcode = '22023';
  end if;
  for v_value in select value from jsonb_array_elements(p_names) loop
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'collections_invalid' using errcode = '22023';
    end if;
    v_name := public.collection_name(v_value #>> '{}');
    continue when v_name is null;
    -- As create_collection: one member's new Collections queue up for their positions.
    perform pg_advisory_xact_lock(hashtext('collections:' || p_member::text));
    select id into v_collection from public.collections
     where member_id = p_member and lower(name) = lower(v_name);
    if v_collection is null then
      insert into public.collections (member_id, name, position)
      values (p_member, v_name,
              coalesce((select max(position) from public.collections where member_id = p_member), 0) + 1)
      returning id into v_collection;
    end if;
    insert into public.collection_entries (collection_id, entry_id, position)
    values (v_collection, p_entry,
            coalesce((select max(position) from public.collection_entries where collection_id = v_collection), 0) + 1)
    on conflict (collection_id, entry_id) do nothing;
  end loop;
end;
$function$
;
