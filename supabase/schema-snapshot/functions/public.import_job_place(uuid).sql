CREATE OR REPLACE FUNCTION public.import_job_place(p_job uuid)
 RETURNS TABLE(state text, ahead integer, rows_ahead integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not exists (select 1 from public.import_jobs where id = p_job and member_id = v_member) then
    raise exception 'job_unknown' using errcode = 'P0002';
  end if;
  return query select s.state, s.ahead, s.rows_ahead from private.import_slot_state(v_member, 'job:' || p_job::text) s;
end
$function$
;
