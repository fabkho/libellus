CREATE OR REPLACE FUNCTION private.shelf_publish_on_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_owner uuid := (select owner_id from private.shelf_publish where id);
begin
  if v_owner is null or v_owner is distinct from coalesce(new.member_id, old.member_id) then
    return null;
  end if;
  begin
    perform private.shelf_publish_changed(v_owner);
  exception when others then
    raise warning 'shelf publish dispatch skipped: %', sqlerrm;
  end;
  return null;
end;
$function$
;
