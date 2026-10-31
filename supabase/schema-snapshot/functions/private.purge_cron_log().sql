CREATE OR REPLACE FUNCTION private.purge_cron_log()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  v_gone bigint;
begin
  -- A run still going has no end_time and stays.
  delete from cron.job_run_details where end_time < now() - interval '7 days';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$function$
;
