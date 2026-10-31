CREATE OR REPLACE FUNCTION private.import_collection_order_valid(p_order jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_item jsonb;
  v_key jsonb;
begin
  if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) > 500 or pg_column_size(p_order) > 1000000 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_order) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'name') is distinct from 'string'
       or public.collection_name(v_item ->> 'name') is null
       or jsonb_typeof(v_item -> 'keys') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(v_item -> 'keys') > 10000 then return false; end if;
    for v_key in select value from jsonb_array_elements(v_item -> 'keys') loop
      if jsonb_typeof(v_key) <> 'string' or char_length(v_key #>> '{}') not between 1 and 300 then return false; end if;
    end loop;
  end loop;
  return true;
end
$function$
;
