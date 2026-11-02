CREATE OR REPLACE FUNCTION private.buddy_on_member_unlink()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  new.hand_through := greatest(coalesce(old.hand_through, 0), old.read_through);
  new.auto_through := null;
  return new;
end;
$function$
;
