CREATE OR REPLACE FUNCTION public.import_slot_beat(p_holder text, p_done integer DEFAULT NULL::integer)
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
  -- Her own beat counts before the sweep: a beat that comes late but before anyone swept keeps the place.
  update public.import_queue
     set beat_at = clock_timestamp(), done = greatest(done, least(coalesce(p_done, done), rows))
   where member_id = v_member and holder = p_holder;
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$function$
;
