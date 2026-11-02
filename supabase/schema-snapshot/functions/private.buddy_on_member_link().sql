CREATE OR REPLACE FUNCTION private.buddy_on_member_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_refresh(new.buddy_read_id, new.member_id);
  return null;
end;
$function$
;
