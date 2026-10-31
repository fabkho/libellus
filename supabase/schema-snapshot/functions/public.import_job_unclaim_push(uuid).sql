CREATE OR REPLACE FUNCTION public.import_job_unclaim_push(p_job uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  update public.import_jobs set notified_at = null where id = p_job and state in ('done', 'failed')
$function$
;
