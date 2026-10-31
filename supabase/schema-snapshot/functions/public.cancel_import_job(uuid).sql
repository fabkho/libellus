CREATE OR REPLACE FUNCTION public.cancel_import_job(p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  update public.import_jobs
     set state = 'cancelled', finished_at = now(), runner = null, lease_until = null
   where id = p_job and member_id = v_member and state in ('queued', 'running', 'paused');
  if not found then return false; end if;
  perform private.import_job_dequeue(p_job);
  -- Her rows name her books: nothing is left to look up, so they go with the cancel.
  delete from public.import_job_rows where job_id = p_job;
  perform private.import_job_kick(false);
  return true;
end
$function$
;
