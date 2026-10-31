CREATE OR REPLACE FUNCTION public.purge_synced_writes()
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  with gone as (
    delete from public.synced_writes
    where synced_at < now() - interval '30 days'
    returning 1
  )
  select count(*) from gone;
$function$
;
