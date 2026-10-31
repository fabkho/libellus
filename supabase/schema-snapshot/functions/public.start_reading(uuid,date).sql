CREATE OR REPLACE FUNCTION public.start_reading(p_entry_id uuid, p_started_on date)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locked, so two taps from two devices cannot both start a read.
  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.status = 'reading' then
    raise exception 'already_reading' using errcode = '23505';
  end if;
  if v_entry.status = 'finished' then
    raise exception 'already_finished' using errcode = '22023';
  end if;
  if p_started_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;

  insert into public.reading_sessions (entry_id, started_on)
  values (v_entry.id, p_started_on)
  returning * into v_session;
  return v_session;
end;
$function$
;
