CREATE OR REPLACE FUNCTION public.finish_reading(p_entry_id uuid, p_ended_on date, p_rating integer DEFAULT NULL::integer, p_review text DEFAULT NULL::text, p_review_spoilers boolean DEFAULT false)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_member  uuid := auth.uid();
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review  text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
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

  -- Locked too: a write that skips the entry (the import, as the service role)
  -- cannot close it under us; one that did finds it gone here.
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
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;

  update public.reading_sessions
     set ended_on = p_ended_on,
         outcome  = 'finished',
         rating   = p_rating,
         review   = v_review,
         review_spoilers = (v_review is not null and coalesce(p_review_spoilers, false))
   where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$function$
;
