CREATE OR REPLACE FUNCTION public.archive_buddy_read(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  perform private.buddy_host_gate(p_id, v_caller);
  update public.buddy_reads
     set status = 'archived', archived_at = clock_timestamp(),
         finished_at = coalesce(finished_at, clock_timestamp())
   where id = p_id and status <> 'archived';
end;
$function$
;
