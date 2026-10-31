CREATE OR REPLACE FUNCTION private.import_slot_sweep()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  delete from public.import_queue q
   where case
           when q.holder like 'job:%' then not exists (
             select 1 from public.import_jobs j
              where 'job:' || j.id::text = q.holder and j.state in ('queued', 'running'))
           else q.beat_at < clock_timestamp() - private.import_slot_ttl()
         end;
  if not exists (select 1 from public.import_queue where started_at is not null) then
    update public.import_queue
       set started_at = clock_timestamp()
     where member_id = (
       select q.member_id from public.import_queue q order by q.joined_at, q.member_id limit 1
     );
  end if;
end
$function$
;
