CREATE OR REPLACE FUNCTION private.buddy_on_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_refresh_entry(new.id);
  return null;
end;
$function$
;
