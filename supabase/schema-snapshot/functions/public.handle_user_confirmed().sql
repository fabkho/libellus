CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform public.admit_user(new.id, new.raw_user_meta_data);
  return new;
end;
$function$
;
