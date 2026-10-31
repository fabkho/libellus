CREATE OR REPLACE FUNCTION public.import_job_claim_push(p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_job public.import_jobs;
begin
  update public.import_jobs
     set notified_at = now()
   where id = p_job and state in ('done', 'failed') and notified_at is null
  returning * into v_job;
  if v_job.id is null then return null; end if;
  return jsonb_build_object(
    'member_id', v_job.member_id,
    'state', v_job.state,
    'added', v_job.added,
    'kept', v_job.kept + v_job.already,
    'failed', v_job.failed
  );
end
$function$
;
