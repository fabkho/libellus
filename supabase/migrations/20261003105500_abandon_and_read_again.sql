-- Abandon a read, and read a book again (issue #1, Library actions; issue #10).
--
-- Two more Library actions beside start_reading and finish_reading, each one
-- call and every rule in the database, so a native client gets the same
-- refusals:
--
--   abandon_reading  Currently reading → Finished (abandoned): ends the open
--                    read with a day and an optional reason. The entry is
--                    Finished by the derived status; the Library's *Not
--                    finished* filter is the entries whose latest session
--                    is abandoned (`latest_session(e).outcome`), not a status.
--   read_again       Finished → Currently reading: opens a new session on an
--                    entry whose latest session is closed (finished or
--                    abandoned, "Read again" / "Start again"). The earlier
--                    sessions stay as they were.
--
-- Refusals are `raise` messages with stable SQLSTATEs, the ones start_reading
-- and finish_reading already use plus two of their own:
--   not_signed_in          42501  no member behind the call
--   entry_not_found        P0002  no such entry in this member's Library
--   not_reading            22023  abandon: there is no open session to end
--   already_reading        23505  read again: the latest session is open
--   never_read             22023  read again: the entry has no session yet; its
--                                 first read is start_reading
--   date_invalid           22023  a date the action needs is missing
--   date_in_future         22023  a date later than today (the sessions trigger)
--   ended_before_started   22023  abandon: an end day before the read's start
--   reason_too_long        22023  an abandon reason over 1,000 characters
--
-- "Only when the latest session is closed" is the combination of two rules the
-- schema already has: an open session is always the latest, and an entry has
-- at most one open session (reading_sessions_one_open). read_again checks it
-- first, under the entry's lock, so the member hears already_reading rather
-- than a unique violation.

-- ------------------------------------------------------------ abandon_reading

-- Ends the open read of an entry as abandoned on `p_ended_on`, with an optional
-- reason (trimmed; blank is none). Returns the closed session; the entry is
-- Finished from now on, and its latest session says it was not finished.
create function public.abandon_reading(
  p_entry_id uuid,
  p_ended_on date,
  p_reason   text default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
$$;

revoke all on function public.abandon_reading(uuid, date, text) from public, anon;
grant execute on function public.abandon_reading(uuid, date, text) to authenticated;

-- ----------------------------------------------------------------- read_again

-- Starts the next read of an entry on `p_started_on`: "Read again" after a
-- finished read, "Start again" after an abandoned one. Only when the latest
-- session is closed. Returns the new open session; the entry is Currently
-- reading, and the sessions before it are kept as they were.
create function public.read_again(p_entry_id uuid, p_started_on date)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locked, so two taps from two devices cannot both start the next read.
  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if v_entry.status = 'reading' then
    raise exception 'already_reading' using errcode = '23505';
  end if;
  if v_entry.status = 'want_to_read' then
    raise exception 'never_read' using errcode = '22023';
  end if;
  if p_started_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;

  insert into public.reading_sessions (entry_id, started_on)
  values (v_entry.id, p_started_on)
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.read_again(uuid, date) from public, anon;
grant execute on function public.read_again(uuid, date) to authenticated;
