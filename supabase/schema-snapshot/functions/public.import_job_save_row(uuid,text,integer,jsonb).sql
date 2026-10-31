CREATE OR REPLACE FUNCTION public.import_job_save_row(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_row public.import_job_rows;
  v_outcome text := p_result ->> 'outcome';
  v_tier text := p_result ->> 'tier';
  v_cover text := p_result ->> 'cover';
  v_source text;
  v_state text;
  v_written text;
  v_done integer;
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  if v_row.state = 'done' then return true; end if;
  if coalesce((p_result ->> 'defer')::boolean, false) and v_row.pass = 0 then
    update public.import_job_rows set pass = 1, taken_by = null, attempts = 0 where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  v_state := case when v_cover = 'none' then 'pending' else 'done' end;
  v_source := case v_cover when 'own' then 'edition' when 'lent' then 'lent' when 'goodreads' then 'goodreads'
                           when 'none' then null else 'none' end;
  v_outcome := coalesce(v_row.outcome, v_outcome);
  update public.import_job_rows
     set state = 'done', taken_by = null, done_at = now(),
         verdict = p_result ->> 'verdict',
         tier = v_tier,
         -- A write recorded already (import_job_write) stands.
         outcome = v_outcome,
         entry_id = coalesce(v_row.entry_id, nullif(p_result ->> 'entry_id', '')::uuid),
         error = left(coalesce(v_row.error, p_result ->> 'error'), 200),
         edition = p_result -> 'edition',
         match_book = p_result -> 'write',
         write_state = case when v_outcome is not null then 'done' else 'pending' end,
         cover = v_cover,
         cover_state = v_state,
         cover_source = v_source,
         cover_url = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_url') ~ '^https://[^[:space:]]+$'
                          then p_result ->> 'cover_url' end,
         cover_size = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_size') in ('S', 'M', 'L')
                           then p_result ->> 'cover_size' end
   where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set done = done + 1,
         -- A result without an outcome or a tier counts as neither (a NULL would void the count).
         added = added + coalesce((v_outcome = 'added')::integer, 0),
         kept = kept + coalesce((v_outcome in ('imported', 'in_library'))::integer, 0),
         failed = failed + coalesce((v_outcome = 'failed')::integer, 0),
         needs_look = needs_look + coalesce((v_tier = 'needsLook')::integer, 0),
         cover_edition = cover_edition + coalesce((v_source = 'edition')::integer, 0),
         cover_lent = cover_lent + coalesce((v_source = 'lent')::integer, 0),
         cover_goodreads = cover_goodreads + coalesce((v_source = 'goodreads')::integer, 0),
         cover_none = cover_none + coalesce((v_source = 'none')::integer, 0),
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning done, member_id into v_done, v_member;
  -- The queue's beat: the others in line see how far it is.
  update public.import_queue set beat_at = clock_timestamp(), done = least(v_done, rows)
   where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$function$
;
