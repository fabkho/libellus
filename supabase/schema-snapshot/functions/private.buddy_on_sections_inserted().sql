CREATE OR REPLACE FUNCTION private.buddy_on_sections_inserted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read uuid;
begin
  for v_read in select distinct n.buddy_read_id from new_rows n order by 1 loop
    perform private.buddy_refresh_read(v_read);
  end loop;
  return null;
end;
$function$
;
