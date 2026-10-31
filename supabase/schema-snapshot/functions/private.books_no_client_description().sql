CREATE OR REPLACE FUNCTION private.books_no_client_description()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.owner_id is null then
    new.description := null;
  end if;
  return new;
end;
$function$
;
