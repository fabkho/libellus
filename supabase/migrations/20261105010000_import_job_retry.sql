-- The app follows its import job (proposal #329, part 5): the member picks a file, the app uploads the rows
-- (`start_import_job`) and from then on only watches the job (Realtime on `import_jobs`, RLS select-own; the publication
-- is part 1's, tests/import_jobs_test.sql pins it).
--
-- One thing the app needs that part 1 did not give it: "Try again" on a FAILED job (the job gave up: nothing sourced for
-- 30 minutes, or five chunks in a row without a row saved). The device keeps no file any more (the import's IndexedDB copy is
-- gone with the device-side import), so the retry starts a new job from the failed job's own rows: the rows that have no
-- outcome yet, or failed, exactly as the device uploaded them. Rows written already stay out (the new job counts them as
-- `already`, like the device's own "already in your Library"), and `import_books` would answer `imported` for them anyway.
--
-- It goes through `start_import_job` as the member (one live job, one start per 2 minutes, her device import first), so
-- its refusals are the start's: import_running, import_too_soon, device_import_running. Its own:
--   job_unknown (P0002)    not her job, or its rows are gone (they are deleted 30 days after the job ends)
--   job_not_failed (55000) only a failed job is retried (a cancelled one is started again from a file)

create function public.retry_import_job(p_job uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_job public.import_jobs;
  v_rows jsonb;
  v_left integer;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into v_job from public.import_jobs where id = p_job and member_id = v_member;
  if v_job.id is null then raise exception 'job_unknown' using errcode = 'P0002'; end if;
  if v_job.state <> 'failed' then raise exception 'job_not_failed' using errcode = '55000'; end if;
  select jsonb_agg(r.payload order by r.idx), count(*)::integer
    into v_rows, v_left
    from public.import_job_rows r
   where r.job_id = p_job and (r.outcome is null or r.outcome = 'failed');
  if v_rows is null then raise exception 'job_unknown' using errcode = 'P0002'; end if;
  return public.start_import_job(
    v_rows,
    v_job.source,
    v_job.device,
    least(100000, v_job.already + greatest(0, v_job.total - v_left)),
    v_job.languages
  );
end
$$;

revoke all on function public.retry_import_job(uuid) from public, anon;
grant execute on function public.retry_import_job(uuid) to authenticated;
