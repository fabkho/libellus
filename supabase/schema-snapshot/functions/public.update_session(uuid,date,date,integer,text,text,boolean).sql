CREATE OR REPLACE FUNCTION public.update_session(p_session_id uuid, p_started_on date, p_ended_on date, p_rating integer DEFAULT NULL::integer, p_review text DEFAULT NULL::text, p_abandon_reason text DEFAULT NULL::text, p_review_spoilers boolean DEFAULT false)
 RETURNS reading_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_member   uuid := auth.uid();
  -- Trimmed of spaces and line breaks; blank is none.
  v_review   text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
  v_reason   text := nullif(regexp_replace(p_abandon_reason, '^\s+|\s+$', '', 'g'), '');
  v_entry_id uuid;
  v_session  public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  -- The entry first and locked, then the read: the order the other actions lock in.
  select s.entry_id into v_entry_id
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id
   where s.id = p_session_id and e.member_id = v_member;
  if v_entry_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.library_entries where id = v_entry_id for update;
  select * into v_session from public.reading_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_session.outcome is null then
    -- Still being read.
    if p_ended_on is not null or p_rating is not null or v_review is not null or v_reason is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    if p_started_on is null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
  else
    if v_session.outcome = 'finished' then
      if v_reason is not null then
        raise exception 'session_invalid' using errcode = '22023';
      end if;
    elsif p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    if p_ended_on is null and v_session.ended_on is not null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
    if p_started_on > p_ended_on then
      raise exception 'ended_before_started' using errcode = '22023';
    end if;
    if p_rating is not null and p_rating not between 1 and 20 then
      raise exception 'rating_invalid' using errcode = '22023';
    end if;
    if char_length(v_review) > 10000 then
      raise exception 'review_too_long' using errcode = '22023';
    end if;
    if char_length(v_reason) > 1000 then
      raise exception 'reason_too_long' using errcode = '22023';
    end if;
  end if;

  -- The future check is the sessions trigger's; the entry's Status follows from
  -- the dates through the other one.
  update public.reading_sessions
     set started_on     = p_started_on,
         ended_on       = p_ended_on,
         rating         = p_rating,
         review         = v_review,
         review_spoilers = (v_review is not null and coalesce(p_review_spoilers, false)),
         abandon_reason = v_reason
   where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$function$
;
