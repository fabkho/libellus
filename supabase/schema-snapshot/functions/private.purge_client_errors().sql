CREATE OR REPLACE FUNCTION private.purge_client_errors()
 RETURNS bigint
 LANGUAGE sql
 SET search_path TO 'pg_catalog'
AS $function$
  with gone as (
    delete from private.client_errors
    where created_at < now() - interval '30 days'
    returning 1
  )
  select count(*) from gone;
$function$
;
