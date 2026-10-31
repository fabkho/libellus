CREATE OR REPLACE FUNCTION private.reader_highlights_forward_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
begin
  if new.updated_at <= old.updated_at then
    return null;
  end if;
  new.member_id  := old.member_id;
  new.entry_id   := old.entry_id;
  new.created_at := old.created_at;
  return new;
end;
$function$
;
