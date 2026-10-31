CREATE OR REPLACE FUNCTION private.import_job_due()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select exists (
    select 1
      from public.import_jobs j
      join public.import_queue q on q.holder = 'job:' || j.id::text and q.member_id = j.member_id and q.started_at is not null
     where j.state in ('queued', 'running')
       and (j.lease_until is null or j.lease_until < now())
  )
$function$
;
