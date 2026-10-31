CREATE OR REPLACE FUNCTION public.start_import_job(p_rows jsonb, p_source text, p_device text DEFAULT NULL::text, p_already integer DEFAULT 0, p_languages text[] DEFAULT '{}'::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_job uuid;
  v_count integer;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 10000
     or pg_column_size(p_rows) > 5000000 then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  if p_source is null or p_source !~ '^[a-z]{1,20}$' then raise exception 'source_invalid' using errcode = '22023'; end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then
    raise exception 'device_invalid' using errcode = '22023';
  end if;
  if p_already is null or p_already not between 0 and 100000 then raise exception 'already_invalid' using errcode = '22023'; end if;
  if p_languages is null or cardinality(p_languages) > 5
     or exists (select 1 from unnest(p_languages) l where l is null or l !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})?$') then
    raise exception 'languages_invalid' using errcode = '22023';
  end if;
  -- Every row an object with a key of its own, at most 20 kB.
  select count(*) into v_count
    from jsonb_array_elements(p_rows) r
   where jsonb_typeof(r) <> 'object'
      or jsonb_typeof(r -> 'key') <> 'string'
      or char_length(r ->> 'key') not between 1 and 300
      or pg_column_size(r) > 20000;
  if v_count > 0 then raise exception 'rows_invalid' using errcode = '22023'; end if;
  if (select count(distinct r ->> 'key') from jsonb_array_elements(p_rows) r) <> jsonb_array_length(p_rows) then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  if exists (select 1 from public.import_jobs where member_id = v_member and state in ('queued', 'running', 'paused')) then
    raise exception 'import_running' using errcode = '55000';
  end if;
  -- Her device import still holds a place (the slot or a place in line): it has to leave first (import_slot_leave),
  -- so a job never takes over a place whose import is still writing on the device.
  if exists (select 1 from public.import_queue where member_id = v_member and holder not like 'job:%') then
    raise exception 'device_import_running' using errcode = '55000';
  end if;
  -- One start per member per 2 minutes (every start stores up to 5 MB and calls the function).
  if exists (select 1 from public.import_jobs where member_id = v_member and created_at > now() - interval '2 minutes') then
    raise exception 'import_too_soon' using errcode = '55000';
  end if;
  insert into public.import_jobs (member_id, device, source, languages, total, already)
  values (v_member, p_device, p_source, p_languages, jsonb_array_length(p_rows), p_already)
  returning id into v_job;
  insert into public.import_job_rows (job_id, idx, key, payload)
  select v_job, (r.ord - 1)::integer, r.value ->> 'key', r.value
    from jsonb_array_elements(p_rows) with ordinality as r (value, ord);
  perform private.import_job_enqueue(v_job);
  -- Member-triggered: held back by the debounce (the tick, every minute, is the safety net).
  perform private.import_job_kick(false);
  return v_job;
end
$function$
;
