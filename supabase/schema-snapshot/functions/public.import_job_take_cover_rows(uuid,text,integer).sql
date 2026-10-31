CREATE OR REPLACE FUNCTION public.import_job_take_cover_rows(p_job uuid, p_runner text, p_limit integer DEFAULT 8)
 RETURNS TABLE(idx integer, key text, payload jsonb, edition jsonb, cover_state text, cover_tries smallint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_gave_up integer;
  v_step text;
begin
  if not private.import_job_held(p_job, p_runner) then return; end if;
  if exists (select 1 from public.import_job_rows r where r.job_id = p_job and r.state = 'pending') then return; end if;
  with gone as (
    update public.import_job_rows r
       set cover_state = 'done', cover_source = 'none', cover_url = null, cover_size = null, cover_taken_by = null
     where r.job_id = p_job and r.cover_state <> 'done' and r.cover_attempts >= 3 and r.cover_taken_by is distinct from p_runner
    returning 1
  )
  select count(*) into v_gave_up from gone;
  if v_gave_up > 0 then
    update public.import_jobs set cover_none = cover_none + v_gave_up, progress_at = clock_timestamp() where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_step := case when exists (select 1 from public.import_job_rows r where r.job_id = p_job and r.cover_state = 'pending')
                 then 'pending' else 'goodreads' end;
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.cover_state = v_step and r.cover_taken_by is distinct from p_runner
         and (r.cover_not_before is null or r.cover_not_before <= now())
       order by r.idx
       limit greatest(1, least(coalesce(p_limit, 8), 50))
       for update
    )
    update public.import_job_rows r
       set cover_taken_by = p_runner, cover_attempts = r.cover_attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.edition, r.cover_state, r.cover_tries;
end
$function$
;
