CREATE OR REPLACE FUNCTION public.import_job_save_write(p_job uuid, p_runner text, p_idx integer, p_result jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.import_job_rows;
  v_outcome text;
  v_done integer;
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  if v_row.write_state = 'done' then return true; end if;
  if v_row.outcome is null then
    v_outcome := p_result ->> 'outcome';
    if v_outcome is null or v_outcome not in ('added', 'imported', 'in_library', 'failed') then
      raise exception 'write_missing' using errcode = '22023';
    end if;
    update public.import_job_rows
       set outcome = v_outcome, entry_id = nullif(p_result ->> 'entry_id', '')::uuid, error = left(p_result ->> 'error', 200)
     where job_id = p_job and idx = p_idx;
  else
    v_outcome := v_row.outcome;
  end if;
  update public.import_job_rows set write_state = 'done', write_taken_by = null where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set added = added + (v_outcome = 'added')::integer,
         kept = kept + (v_outcome in ('imported', 'in_library'))::integer,
         failed = failed + (v_outcome = 'failed')::integer,
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning done, member_id into v_done, v_member;
  update public.import_queue set beat_at = clock_timestamp() where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$function$
;
