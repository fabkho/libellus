CREATE OR REPLACE FUNCTION public.finish_buddy_read(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  update public.buddy_reads set status = 'finished', finished_at = clock_timestamp()
   where id = p_id and status = 'active';
end;
$function$
;
