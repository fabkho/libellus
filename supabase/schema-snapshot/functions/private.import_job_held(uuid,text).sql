CREATE OR REPLACE FUNCTION private.import_job_held(p_job uuid, p_runner text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (select 1 from public.import_jobs where id = p_job and state = 'running' and runner = p_runner)
$function$
;
