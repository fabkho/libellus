-- Reading history and removing (issue #1, Library actions; issue #11).
--
-- Three more Library actions beside start_reading, finish_reading,
-- abandon_reading and read_again, each one call with every rule in the
-- database, so a native client gets the same refusals:
--
--   update_session     fixes one read: its dates and, by its outcome, the Rating
--                      and review (finished) or the abandon reason (abandoned).
--                      The same rules as creating the read.
--   delete_session     deletes one read ("a start I logged by accident"). The
--                      entry's Status follows from the sessions it has left;
--                      deleting the only one returns it to Want to read.
--   remove_from_library  deletes the entry with its sessions and its Collection
--                      memberships (foreign keys with `on delete cascade`: no
--                      code of ours has to remember them). Collections stay.
--
-- Nothing here writes `library_entries.status`: the sessions trigger recomputes
-- it after every change, a delete included.
--
-- update_session takes the whole editable state of the read, not a patch: the
-- Edit sheet shows all of it and sends all of it. What may be set follows from
-- the session's outcome, which an edit never changes (finishing and abandoning
-- are their own actions):
--   open       the start day only (it needs one; no end, Rating, review, reason)
--   finished   start (may be none), end, Rating, review; no abandon reason
--   abandoned  start (may be none), end, abandon reason; no Rating or review,
--              as when it was abandoned
-- A closed read needs an end day, as finish_reading and abandon_reading do;
-- only one that has none already (a read logged after the fact, imported) may
-- stay without.
--
-- Refusals are `raise` messages with stable SQLSTATEs, the ones the other
-- actions use plus one of their own:
--   not_signed_in          42501  no member behind the call
--   session_not_found      P0002  no such read in this member's Library (another
--                                 member's read is "not found" too)
--   entry_not_found        P0002  remove: no such entry in this member's Library
--   date_invalid           22023  a day the read needs is missing
--   date_in_future         22023  a day later than today (the sessions trigger)
--   ended_before_started   22023  an end day before the start day
--   session_invalid        22023  a value that does not belong to the read's
--                                 outcome (a Rating on an open read, a reason
--                                 on a finished one …)
--   rating_invalid         22023  a Rating outside 1–20 quarters
--   review_too_long        22023  a review over 10,000 characters
--   reason_too_long        22023  an abandon reason over 1,000 characters

-- ------------------------------------------------------------- update_session

create function public.update_session(
  p_session_id     uuid,
  p_started_on     date,
  p_ended_on       date,
  p_rating         integer default null,
  p_review         text default null,
  p_abandon_reason text default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
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
         abandon_reason = v_reason
   where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.update_session(uuid, date, date, integer, text, text) from public, anon;
grant execute on function public.update_session(uuid, date, date, integer, text, text) to authenticated;

-- ------------------------------------------------------------- delete_session

-- Deletes one read. The entry stays with the reads it has left: Want to read
-- when there are none, Currently reading when the latest is open, otherwise
-- Finished (the sessions trigger decides, as after any other change).
create function public.delete_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member   uuid := auth.uid();
  v_entry_id uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select s.entry_id into v_entry_id
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id
   where s.id = p_session_id and e.member_id = v_member;
  if v_entry_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  -- Locked, so a read started on another device cannot slip in between the
  -- delete and the Status that follows it.
  perform 1 from public.library_entries where id = v_entry_id for update;

  delete from public.reading_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_session(uuid) from public, anon;
grant execute on function public.delete_session(uuid) to authenticated;

-- --------------------------------------------------------- remove_from_library

-- Removes an entry from the member's Library: its reading sessions and its
-- Collection memberships go with it (`on delete cascade`), the Collections stay
-- and so does the Book in the Catalogue. A Manual book is the member's own and
-- stays too, unreachable until it is added again.
create function public.remove_from_library(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  delete from public.library_entries where id = p_entry_id and member_id = v_member;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.remove_from_library(uuid) from public, anon;
grant execute on function public.remove_from_library(uuid) to authenticated;
