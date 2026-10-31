CREATE OR REPLACE FUNCTION public.catalogue_check_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'unchecked', (select count(*) from public.books where owner_id is null and checked_at is null),
    'checked', (select count(*) from public.books where owner_id is null and checked_at is not null and not check_failed and not check_unknown),
    'unknown', (select count(*) from public.books where owner_id is null and check_unknown),
    'failed', (select count(*) from public.books where owner_id is null and check_failed),
    'backingOff', (select count(*) from private.catalogue_check_state where not_before > now()),
    -- The last call the cron made and what it answered (a 401 here: the token the function has is not the Vault's).
    'lastKickAt', (select last_kick_at from private.catalogue_check_settings where id),
    'lastStatus', (select last_status from private.catalogue_check_settings where id),
    'lastError', (select last_error from private.catalogue_check_settings where id)
  )
$function$
;
