CREATE OR REPLACE FUNCTION public.import_job_write(p_job uuid, p_runner text, p_idx integer, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.import_job_rows;
  v_outcome jsonb;
  v_before text[];
begin
  v_before := private.import_job_as_member(p_job, p_runner);
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then raise exception 'row_unknown' using errcode = 'P0002'; end if;
  if v_row.outcome is not null then
    perform private.import_job_as_caller(v_before);
    return jsonb_build_object('key', v_row.key, 'outcome', v_row.outcome, 'entry_id', v_row.entry_id, 'error', v_row.error);
  end if;
  -- The row's key is the file's: a payload naming another row's key writes nothing of it.
  if p_row is null or jsonb_typeof(p_row) <> 'object' or p_row ->> 'key' is distinct from v_row.key then
    raise exception 'row_invalid' using errcode = '22023';
  end if;
  -- The job's first write makes her empty Collections (once; the ones she has already stay as they are).
  perform private.import_job_make_empty_collections(p_job);
  select value into v_outcome from jsonb_array_elements(public.import_books(jsonb_build_array(p_row))) limit 1;
  update public.import_job_rows
     set outcome = v_outcome ->> 'outcome',
         entry_id = nullif(v_outcome ->> 'entry_id', '')::uuid,
         error = left(v_outcome ->> 'error', 200)
   where job_id = p_job and idx = p_idx;
  perform private.import_job_as_caller(v_before);
  return v_outcome;
end
$function$
;
