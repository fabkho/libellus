CREATE OR REPLACE FUNCTION private.reader_places_forward_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  return new;
end;
$function$
;
