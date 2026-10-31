CREATE OR REPLACE FUNCTION private.purge_activity()
 RETURNS bigint
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with gone as (
    delete from public.activity
    where created_at < now() - interval '13 months'
    returning 1
  )
  select count(*) from gone;
$function$
;
