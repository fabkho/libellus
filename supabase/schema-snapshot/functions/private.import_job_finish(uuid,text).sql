CREATE OR REPLACE FUNCTION private.import_job_finish(p_job uuid, p_runner text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lists public.import_job_collections;
  v_job public.import_jobs;
  v_before text[];
  v_item jsonb;
  v_name text;
  v_collection uuid;
  v_new uuid[];
  v_old uuid[];
begin
  select * into v_lists from public.import_job_collections where job_id = p_job for update;
  if v_lists.job_id is null then return; end if;
  select * into v_job from public.import_jobs where id = p_job;
  begin
    v_before := private.import_job_as_member(p_job, p_runner);
    perform private.import_job_make_empty_collections(p_job);
    for v_item in select value from jsonb_array_elements(v_lists.collection_order) loop
      begin
        v_name := public.collection_name(v_item ->> 'name');
        continue when v_name is null;
        select id into v_collection from public.collections where member_id = v_job.member_id and lower(name) = lower(v_name);
        continue when v_collection is null;
        select coalesce(array_agg(x.entry_id order by x.ord), '{}') into v_new
          from (
            select s.entry_id, min(s.ord) as ord
              from (
                select coalesce(r.entry_id, le.id) as entry_id, k.ord
                  from jsonb_array_elements_text(v_item -> 'keys') with ordinality as k (key, ord)
                  left join public.import_job_rows r on r.job_id = p_job and r.key = k.key and r.outcome is distinct from 'failed'
                  left join public.library_entries le on le.member_id = v_job.member_id and le.import_key = k.key
              ) s
              join public.collection_entries ce on ce.collection_id = v_collection and ce.entry_id = s.entry_id
             where ce.added_at >= v_lists.began_at
             group by s.entry_id
          ) x;
        select coalesce(array_agg(ce.entry_id order by ce.position), '{}') into v_old
          from public.collection_entries ce
         where ce.collection_id = v_collection and not (ce.entry_id = any (v_new));
        perform public.reorder_collection(v_collection, v_old || v_new);
      exception when others or query_canceled then
        raise warning 'import_job_finish %: a list was not put in order: %', p_job, sqlerrm;
      end;
    end loop;
  exception when others or query_canceled then
    raise warning 'import_job_finish %: %', p_job, sqlerrm;
  end;
  -- `import_job_as_member` raises before it sets anything, so no claims to give back when it failed.
  if v_before is not null then perform private.import_job_as_caller(v_before); end if;
  delete from public.import_job_collections where job_id = p_job;
end
$function$
;
