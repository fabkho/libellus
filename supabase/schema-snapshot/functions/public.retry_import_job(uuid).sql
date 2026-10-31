CREATE OR REPLACE FUNCTION public.retry_import_job(p_job uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_job public.import_jobs;
  v_rows jsonb;
  v_left integer;
  v_lists public.import_job_collections;
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
  select * into v_lists from public.import_job_collections where job_id = p_job;
  return public.start_import_job(
    v_rows,
    v_job.source,
    v_job.device,
    least(100000, v_job.already + greatest(0, v_job.total - v_left)),
    v_job.languages,
    v_lists.collection_order,
    v_lists.empty_collections
  );
end
$function$
;
