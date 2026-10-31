CREATE OR REPLACE FUNCTION public.import_job_take_write_rows(p_job uuid, p_runner text, p_limit integer DEFAULT 8)
 RETURNS TABLE(idx integer, key text, payload jsonb, match_book jsonb, cover_source text, cover_url text, cover_size text, outcome text)
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
  if exists (select 1 from public.import_job_rows r where r.job_id = p_job and (r.state = 'pending' or r.cover_state <> 'done')) then
    return;
  end if;
  with gone as (
    update public.import_job_rows r
       set write_state = 'done', outcome = coalesce(r.outcome, 'failed'), write_taken_by = null,
           error = case when r.outcome is null then coalesce(r.error, 'gave_up') else r.error end
     where r.job_id = p_job and r.write_state = 'pending' and r.write_attempts >= 3 and r.write_taken_by is distinct from p_runner
    returning r.outcome as written
  )
  select count(*), count(*) filter (where written = 'added'), count(*) filter (where written in ('imported', 'in_library')),
         count(*) filter (where written = 'failed')
    into v_gave_up, v_added, v_kept, v_failed from gone;
  if v_gave_up > 0 then
    update public.import_jobs
       set added = added + v_added, kept = kept + v_kept, failed = failed + v_failed, progress_at = clock_timestamp()
     where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_suspects := exists (select 1 from public.import_job_rows r
                         where r.job_id = p_job and r.write_state = 'pending' and r.write_taken_by is distinct from p_runner
                           and r.write_attempts >= 2);
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.write_state = 'pending' and r.write_taken_by is distinct from p_runner
       order by (v_suspects and r.write_attempts >= 2) desc, r.idx
       limit case when v_suspects then 1 else greatest(1, least(coalesce(p_limit, 8), 50)) end
       for update
    )
    update public.import_job_rows r
       set write_taken_by = p_runner, write_attempts = r.write_attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.match_book, r.cover_source, r.cover_url, r.cover_size, r.outcome;
end
$function$
;
