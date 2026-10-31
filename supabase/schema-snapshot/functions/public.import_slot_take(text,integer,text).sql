CREATE OR REPLACE FUNCTION public.import_slot_take(p_holder text, p_rows integer DEFAULT 0, p_device text DEFAULT NULL::text)
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
  if p_rows is null or p_rows not between 0 and 100000 then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then
    raise exception 'device_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  -- Her one place: the same run asking again keeps it, and so does the same device in a new run (the app was
  -- closed and opened again): the place changes holder, keeping its turn and the slot. Another device is told it is taken.
  insert into public.import_queue as q (member_id, holder, rows, device)
  values (v_member, p_holder, p_rows, p_device)
  on conflict (member_id) do update
    set holder = excluded.holder, rows = excluded.rows, device = excluded.device, beat_at = clock_timestamp()
    where q.holder not like 'job:%'
      and (q.holder = excluded.holder or (excluded.device is not null and q.device = excluded.device));
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$function$
;
