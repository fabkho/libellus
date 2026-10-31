CREATE OR REPLACE FUNCTION private.import_job_dequeue(p_job uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  delete from public.import_queue where holder = 'job:' || p_job::text;
  perform private.import_slot_sweep();
end
$function$
;
