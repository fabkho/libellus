CREATE OR REPLACE FUNCTION private.import_job_enqueue(p_job uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_job public.import_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  select * into v_job from public.import_jobs where id = p_job;
  if v_job.id is null or v_job.state not in ('queued', 'running') then return; end if;
  insert into public.import_queue as q (member_id, holder, rows, done, device)
  values (v_job.member_id, 'job:' || v_job.id::text, v_job.total, v_job.done, v_job.device)
  on conflict (member_id) do update
    set holder = excluded.holder, rows = excluded.rows, done = excluded.done, device = excluded.device,
        beat_at = clock_timestamp()
    where q.holder is distinct from excluded.holder;
  perform private.import_slot_sweep();
end
$function$
;
