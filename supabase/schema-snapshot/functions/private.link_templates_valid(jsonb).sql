CREATE OR REPLACE FUNCTION private.link_templates_valid(p_templates jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_item jsonb;
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_templates) > 20 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['label', 'url'])
       or (select count(*) from jsonb_object_keys(v_item)) <> 2
       or jsonb_typeof(v_item -> 'label') <> 'string'
       or jsonb_typeof(v_item -> 'url') <> 'string' then
      return false;
    end if;
    if char_length(btrim(v_item ->> 'label')) not between 1 and 40
       or char_length(btrim(v_item ->> 'url')) > 2000
       or btrim(v_item ->> 'url') !~* '^https?://[^[:space:]/?#{}]+([/?#][^[:space:]]*)?$' then
      return false;
    end if;
  end loop;
  return true;
end;
$function$
;
