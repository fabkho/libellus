CREATE OR REPLACE FUNCTION private.buddy_sections_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read uuid;
begin
  if tg_op = 'DELETE' then
    for v_read in select distinct buddy_read_id from old_rows loop
      perform private.buddy_changed(v_read, null);
    end loop;
  else
    for v_read in select distinct buddy_read_id from new_rows loop
      perform private.buddy_changed(v_read, null);
    end loop;
  end if;
  return null;
end;
$function$
;
