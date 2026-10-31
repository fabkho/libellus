CREATE OR REPLACE FUNCTION public.add_first_session(p_entry_id uuid, p_status entry_status, p_started_on date, p_ended_on date, p_rating integer, p_review text, p_review_spoilers boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
begin
  if p_status = 'want_to_read' then
    if p_started_on is not null or p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if p_status = 'reading' then
    if p_started_on is null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
    if p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    insert into public.reading_sessions (entry_id, started_on) values (p_entry_id, p_started_on);
    return;
  end if;

  -- finished
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_started_on is not null and p_ended_on < p_started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;
  insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review, review_spoilers)
  values (p_entry_id, p_started_on, p_ended_on, 'finished', p_rating, v_review,
          v_review is not null and coalesce(p_review_spoilers, false));
end;
$function$
;
