CREATE OR REPLACE FUNCTION private.import_job_make_empty_collections(p_job uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_lists public.import_job_collections;
  v_member uuid;
  v_value jsonb;
  v_name text;
begin
  select * into v_lists from public.import_job_collections where job_id = p_job and not empty_made for update;
  if v_lists.job_id is null then return; end if;
  select member_id into v_member from public.import_jobs where id = p_job;
  begin
    for v_value in select value from jsonb_array_elements(v_lists.empty_collections) loop
      v_name := public.collection_name(v_value #>> '{}');
      continue when v_name is null;
      if not exists (select 1 from public.collections where member_id = v_member and lower(name) = lower(v_name)) then
        perform public.create_collection(v_name);
      end if;
    end loop;
  exception when others then
    raise warning 'import_job_make_empty_collections %: %', p_job, sqlerrm;
  end;
  update public.import_job_collections set empty_made = true where job_id = p_job;
end
$function$
;
