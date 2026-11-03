CREATE OR REPLACE FUNCTION private.buddy_read_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_changed(new.id, null);
  return null;
end;
$function$
;
