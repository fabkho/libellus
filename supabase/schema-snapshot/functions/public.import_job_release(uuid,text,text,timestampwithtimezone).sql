CREATE OR REPLACE FUNCTION public.import_job_release(p_job uuid, p_runner text, p_error text DEFAULT NULL::text, p_wait_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_job public.import_jobs;
  v_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  select * into v_job from public.import_jobs where id = p_job for update;
  if v_job.id is null or v_job.state <> 'running' or v_job.runner is distinct from p_runner then return 'gone'; end if;
  -- Rows handed out but not reached: the runner stopped in time, which is no fault of theirs (only a runner that dies
  -- leaves a row's attempt counted).
  update public.import_job_rows set taken_by = null, attempts = greatest(attempts - 1, 0)
   where job_id = p_job and state = 'pending' and taken_by = p_runner;
  update public.import_job_rows set cover_taken_by = null, cover_attempts = greatest(cover_attempts - 1, 0)
   where job_id = p_job and cover_state <> 'done' and cover_taken_by = p_runner;
  update public.import_job_rows set write_taken_by = null, write_attempts = greatest(write_attempts - 1, 0)
   where job_id = p_job and write_state = 'pending' and write_taken_by = p_runner;
  if not exists (select 1 from public.import_job_rows where job_id = p_job and (cover_state <> 'done' or write_state <> 'done')) then
    -- The end step: her ranked Collections in order (and her empty ones, when no write made them).
    perform private.import_job_finish(p_job, p_runner);
    update public.import_jobs set state = 'done', finished_at = now(), runner = null, lease_until = null, error = null
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'done';
  end if;
  if p_error is not null then
    update public.import_jobs
       set state = 'paused', runner = null, lease_until = null, error = left(p_error, 500),
           not_before = now() + least(interval '1 minute' * power(2, least(v_job.stalls, 4)), interval '15 minutes')
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'paused';
  end if;
  -- Waiting is not a fault: the stage was told to wait, or every row left is waiting for its retry.
  v_until := p_wait_until;
  if v_until is null and not exists (select 1 from public.import_job_rows where job_id = p_job and state = 'pending')
     and not exists (select 1 from public.import_job_rows
                      where job_id = p_job and cover_state <> 'done' and (cover_not_before is null or cover_not_before <= now())) then
    select min(cover_not_before) into v_until from public.import_job_rows where job_id = p_job and cover_state <> 'done';
  end if;
  if v_until is not null and v_until > now() then
    update public.import_jobs
       set state = 'paused', runner = null, lease_until = null, error = null,
           not_before = least(v_until, now() + interval '1 hour'), progress_at = clock_timestamp()
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'paused';
  end if;
  update public.import_jobs set runner = null, lease_until = null where id = p_job;
  perform private.import_job_kick(true);
  return 'more';
end
$function$
;
