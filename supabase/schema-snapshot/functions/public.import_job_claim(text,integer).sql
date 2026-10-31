CREATE OR REPLACE FUNCTION public.import_job_claim(p_runner text, p_lease_seconds integer DEFAULT 170)
 RETURNS SETOF import_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_job public.import_jobs;
begin
  if p_runner is null or char_length(p_runner) not between 1 and 64 then
    raise exception 'runner_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  select j.* into v_job
    from public.import_jobs j
    join public.import_queue q on q.holder = 'job:' || j.id::text and q.member_id = j.member_id and q.started_at is not null
   where j.state in ('queued', 'running')
   for update of j;
  if v_job.id is null then return; end if;
  if v_job.lease_until is not null and v_job.lease_until >= now() then return; end if;
  -- The last chunk saved nothing: one stall more (five in a row: given up). A first claim is no stall.
  if v_job.claimed_at is not null and v_job.progress_at <= v_job.claimed_at then
    v_job.stalls := v_job.stalls + 1;
  else
    v_job.stalls := 0;
  end if;
  if v_job.stalls >= 5 then
    update public.import_jobs
       set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null, stalls = v_job.stalls
     where id = v_job.id;
    perform private.import_job_dequeue(v_job.id);
    return;
  end if;
  return query
    update public.import_jobs
       set state = 'running', started_at = coalesce(started_at, now()), runner = p_runner, claimed_at = now(),
           lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 170), 600))),
           chunks = chunks + 1, stalls = v_job.stalls, not_before = null,
           -- A job that waited (queued, paused) has had no chance to progress: its 30 minutes start now.
           progress_at = case when v_job.state = 'running' then progress_at else now() end
     where id = v_job.id
    returning *;
end
$function$
;
