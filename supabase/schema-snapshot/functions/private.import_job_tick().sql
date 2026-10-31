CREATE OR REPLACE FUNCTION private.import_job_tick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  for v_job in
    update public.import_jobs
       set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null
     where state = 'running' and progress_at < now() - interval '30 minutes'
    returning id
  loop
    perform private.import_job_dequeue(v_job);
  end loop;
  update public.import_jobs set state = 'queued', not_before = null
   where state = 'paused' and not_before <= now();
  for v_job in
    select j.id from public.import_jobs j
     where j.state in ('queued', 'running')
       and not exists (select 1 from public.import_queue q where q.holder = 'job:' || j.id::text)
     order by j.created_at
  loop
    perform private.import_job_enqueue(v_job);
  end loop;
  perform private.import_slot_sweep();
  delete from public.import_job_rows r
   using public.import_jobs j
   where r.job_id = j.id and j.finished_at < now() - interval '30 days';
  return private.import_job_kick(false);
end
$function$
;
