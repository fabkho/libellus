CREATE OR REPLACE FUNCTION public.import_slot_leave(p_holder text)
 RETURNS TABLE(state text, mine boolean, ahead integer, rows_ahead integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 or p_holder like 'job:%' then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  delete from public.import_queue where member_id = v_member and holder = p_holder;
  -- The slot goes on to the next in line at once, not at the next caller's sweep.
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$function$
;
