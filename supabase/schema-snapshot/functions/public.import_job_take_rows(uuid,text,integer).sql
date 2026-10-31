CREATE OR REPLACE FUNCTION public.import_job_take_rows(p_job uuid, p_runner text, p_limit integer DEFAULT 8)
 RETURNS TABLE(idx integer, key text, payload jsonb, pass smallint, attempts smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_gave_up integer;
  v_added integer;
  v_kept integer;
  v_failed integer;
  v_suspects boolean;
begin
  if not private.import_job_held(p_job, p_runner) then return; end if;
  with gone as (
    update public.import_job_rows r
       set state = 'done', outcome = coalesce(r.outcome, 'failed'), error = coalesce(r.error, 'gave_up'), tier = 'needsLook',
           taken_by = null, done_at = now(), cover_state = 'done', cover_source = 'none', write_state = 'done'
     where r.job_id = p_job and r.state = 'pending' and r.attempts >= 3 and r.taken_by is distinct from p_runner
    returning r.outcome
  )
  select count(*), count(*) filter (where outcome = 'added'), count(*) filter (where outcome in ('imported', 'in_library')),
         count(*) filter (where outcome = 'failed')
    into v_gave_up, v_added, v_kept, v_failed from gone;
  if v_gave_up > 0 then
    -- A row whose write was recorded counts as what it came to, not as failed.
    update public.import_jobs
       set done = done + v_gave_up, added = added + v_added, kept = kept + v_kept, failed = failed + v_failed,
           needs_look = needs_look + v_gave_up, cover_none = cover_none + v_gave_up, progress_at = clock_timestamp()
     where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_suspects := exists (select 1 from public.import_job_rows r
                         where r.job_id = p_job and r.state = 'pending' and r.taken_by is distinct from p_runner and r.attempts >= 2);
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.state = 'pending' and r.taken_by is distinct from p_runner
       order by (v_suspects and r.attempts >= 2) desc, r.pass, r.idx
       limit case when v_suspects then 1 else greatest(1, least(coalesce(p_limit, 8), 50)) end
       for update
    )
    update public.import_job_rows r
       set taken_by = p_runner, attempts = r.attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.pass, r.attempts;
end
$function$
;
