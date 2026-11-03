CREATE OR REPLACE FUNCTION private.buddy_on_member_unlink()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  -- Nothing to keep (no hand value, read_through 0): the hand stays null and `where` becomes not_set.
  if old.hand_through is not null or old.read_through > 0 then
    new.hand_through := greatest(coalesce(old.hand_through, 0), old.read_through);
  end if;
  new.auto_through := null;
  return new;
end;
$function$
;
