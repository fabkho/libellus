CREATE OR REPLACE FUNCTION public.import_job_save_cover(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.import_job_rows;
  v_source text := p_result ->> 'source';
  v_url text := p_result ->> 'url';
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  -- Not matched yet, or decided already: nothing to save (a second save is a no-op).
  if v_row.state <> 'done' or v_row.cover_state = 'done' then return true; end if;
  if coalesce((p_result ->> 'retry')::boolean, false) then
    update public.import_job_rows
       set cover_tries = cover_tries + 1, cover_taken_by = null, cover_attempts = 0,
           cover_not_before = now() + make_interval(secs => least(greatest(coalesce((p_result ->> 'wait_seconds')::integer, 0), 0), 3600))
     where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  if p_result ->> 'next' = 'goodreads' then
    update public.import_job_rows
       set cover_state = 'goodreads', cover_tries = 0, cover_not_before = null, cover_taken_by = null, cover_attempts = 0
     where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  if v_source not in ('openlibrary', 'goodreads', 'none') or (v_source <> 'none' and v_url !~ '^https://[^[:space:]]+$') then
    raise exception 'cover_invalid' using errcode = '22023';
  end if;
  update public.import_job_rows
     set cover_state = 'done', cover_source = v_source, cover_taken_by = null, cover_not_before = null,
         cover_url = case when v_source = 'none' then null else v_url end,
         cover_size = case when v_source <> 'none' and (p_result ->> 'size') in ('S', 'M', 'L') then p_result ->> 'size' end
   where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set cover_openlibrary = cover_openlibrary + (v_source = 'openlibrary')::integer,
         cover_goodreads = cover_goodreads + (v_source = 'goodreads')::integer,
         cover_none = cover_none + (v_source = 'none')::integer,
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning member_id into v_member;
  update public.import_queue set beat_at = clock_timestamp() where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$function$
;
