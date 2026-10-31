CREATE OR REPLACE FUNCTION private.import_empty_collections_valid(p_names jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_name jsonb;
begin
  if jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 500 or pg_column_size(p_names) > 1000000 then
    return false;
  end if;
  for v_name in select value from jsonb_array_elements(p_names) loop
    if jsonb_typeof(v_name) <> 'string' or char_length(v_name #>> '{}') > 1000 then return false; end if;
  end loop;
  return true;
end
$function$
;
