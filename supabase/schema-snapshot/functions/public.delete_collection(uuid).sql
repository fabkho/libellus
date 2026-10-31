CREATE OR REPLACE FUNCTION public.delete_collection(p_collection uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection public.collections := public.own_collection(p_collection);
begin
  delete from public.collections where id = v_collection.id;
end;
$function$
;
