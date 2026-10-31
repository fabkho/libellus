CREATE OR REPLACE FUNCTION public.purge_abandoned_signups()
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with gone as (
    delete from auth.users
    where email_confirmed_at is null
      and created_at < now() - interval '1 day'
    returning 1
  )
  select count(*)::int from gone;
$function$
;
