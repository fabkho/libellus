CREATE OR REPLACE FUNCTION public.library_entries_derive_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.status := public.entry_status_of(new.id);
  return new;
end;
$function$
;
