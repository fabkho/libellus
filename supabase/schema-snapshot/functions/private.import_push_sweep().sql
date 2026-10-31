CREATE OR REPLACE FUNCTION private.import_push_sweep()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_job uuid;
  v_count integer := 0;
begin
  for v_job in
    select j.id
      from public.import_jobs j
     where j.state in ('done', 'failed') and j.notified_at is null
       and j.finished_at between now() - interval '15 minutes' and now() - interval '1 minute'
     order by j.finished_at
     limit 20
  loop
    if private.import_push_kick(v_job) = 'sent' then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end
$function$
;
