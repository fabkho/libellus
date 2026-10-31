CREATE OR REPLACE FUNCTION private.shelf_publish_changed(p_member uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_member is null
     or p_member is distinct from (select owner_id from private.shelf_publish where id) then
    return 'not_owner';
  end if;
  update private.shelf_publish
     set last_changed_at = now()
   where id and last_changed_at is distinct from now();
  return private.shelf_publish_dispatch();
end;
$function$
;
