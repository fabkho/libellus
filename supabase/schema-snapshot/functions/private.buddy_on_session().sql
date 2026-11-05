CREATE OR REPLACE FUNCTION private.buddy_on_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_refresh_entry(case when tg_op = 'DELETE' then old.entry_id else new.entry_id end);
  return null;
end;
$function$
;
