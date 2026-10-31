CREATE OR REPLACE FUNCTION public.abandon_reading(p_entry_id uuid, p_ended_on date, p_reason text DEFAULT NULL::text)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member  uuid := auth.uid();
  -- Trimmed of spaces and line breaks; a blank reason is no reason.
  v_reason  text := nullif(regexp_replace(p_reason, '^\s+|\s+$', '', 'g'), '');
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform 1 from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  select * into v_session from public.reading_sessions
   where entry_id = p_entry_id and outcome is null
     for update;
  if not found then
    raise exception 'not_reading' using errcode = '22023';
  end if;
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_ended_on < v_session.started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'reason_too_long' using errcode = '22023';
  end if;

  update public.reading_sessions
     set ended_on       = p_ended_on,
         outcome        = 'abandoned',
         abandon_reason = v_reason
   where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$function$
;
