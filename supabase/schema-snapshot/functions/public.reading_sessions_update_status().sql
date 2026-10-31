CREATE OR REPLACE FUNCTION public.reading_sessions_update_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op <> 'DELETE' then
    update public.library_entries set status = public.entry_status_of(id) where id = new.entry_id;
  end if;
  -- A session moved to another entry (or deleted) leaves its old entry behind.
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.entry_id <> new.entry_id) then
    update public.library_entries set status = public.entry_status_of(id) where id = old.entry_id;
  end if;
  return null;
end;
$function$
;
