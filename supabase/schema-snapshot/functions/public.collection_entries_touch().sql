CREATE OR REPLACE FUNCTION public.collection_entries_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  update public.collections
     set updated_at = now()
   where id = coalesce(new.collection_id, old.collection_id)
     and updated_at < now();
  return null;
end;
$function$
;
