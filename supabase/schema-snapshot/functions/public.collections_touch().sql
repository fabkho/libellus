CREATE OR REPLACE FUNCTION public.collections_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.name is distinct from old.name then
    new.updated_at := now();
  end if;
  return new;
end;
$function$
;
