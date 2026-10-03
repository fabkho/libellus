-- Reading progress (issue #39; issue #1, Out of Scope, item 1).
--
-- While a Book is Currently reading, the member records how far they are: a
-- page number (when they know the edition's pages) or a percentage. Only the
-- latest value is kept, on the read it belongs to; there is no progress
-- history. Three columns on the session:
--
--   progress_page         0 … the Book's page count (when the Book has one)
--   progress_percent      0 … 100
--   progress_updated_at   when the value was last set
--
-- The rules, all in the database:
--   * one of the two is set, never both, and `progress_updated_at` is set
--     exactly when one of them is (table checks);
--   * a page is never negative, and never past the edition's page count when
--     it has one (`progress_page_fits`, enforced by update_progress);
--   * progress is written only on an open session (update_progress refuses
--     anything else with `not_reading`). Finishing or abandoning does not touch
--     it, so a closed session keeps the last value it had; Read again and Start
--     again insert a new session, which starts with none.
--
-- Members set progress through one function, as every Library action:
--
--   update_progress(p_entry_id, p_page, p_percent)
--
-- Refusals are `raise` messages with stable SQLSTATEs, the ones the other
-- actions use plus one of their own:
--   not_signed_in      42501  no member behind the call
--   entry_not_found    P0002  no such entry in this member's Library
--   not_reading        22023  there is no open session to record progress on
--   progress_invalid   22023  not exactly one of page and percent, a negative
--                             page or one past the page count, a percent
--                             outside 0–100
--
-- The page-count rule is two small functions on purpose, so what changes a
-- Book's page count later (a different edition for the entry, #41) calls the
-- same rule instead of restating it:
--   progress_page_fits(page, page_count)   may this page be stored?
--   clamp_progress_page(page, page_count)  the page as it must be stored once
--                                          the page count is known to be this
--   clamp_session_progress(entry, count)   that clamp applied to all of an
--                                          entry's sessions (closed ones too)

alter table public.reading_sessions
  add column progress_page       integer,
  add column progress_percent    smallint,
  add column progress_updated_at timestamptz,
  add constraint reading_sessions_progress_page_not_negative check (progress_page >= 0),
  add constraint reading_sessions_progress_percent_range check (progress_percent between 0 and 100),
  add constraint reading_sessions_progress_one_kind check (num_nonnulls(progress_page, progress_percent) <= 1),
  add constraint reading_sessions_progress_stamped
    check ((progress_updated_at is not null) = (num_nonnulls(progress_page, progress_percent) = 1));

comment on column public.reading_sessions.progress_page is
  'The page the member is on (latest value only). 0 … the Book''s page count when it has one. '
  'Null when none is set, or when progress is a percentage. Never both.';
comment on column public.reading_sessions.progress_percent is
  'How far through, in whole percent 0–100 (latest value only). Null when none is set, or when '
  'progress is a page. Never both.';
comment on column public.reading_sessions.progress_updated_at is
  'When the progress was last set; null exactly when the session has none.';

-- ------------------------------------------------------------ the page rule

-- Whether a page may be stored against a page count: not negative, and not
-- past the page count when the Book has one. A Book without a page count
-- takes any page (a percentage is what the app offers there).
create function public.progress_page_fits(p_page integer, p_page_count integer)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_page >= 0 and (p_page_count is null or p_page <= p_page_count)
$$;

-- The page as it must be stored once the Book's page count is `p_page_count`:
-- cut back to the last page when it is past it, otherwise as it was. A percent
-- never needs this; it means the same on any edition.
create function public.clamp_progress_page(p_page integer, p_page_count integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_page is null or p_page_count is null then p_page
    else least(p_page, greatest(p_page_count, 0))
  end
$$;

-- `clamp_progress_page` on every session of an entry, closed ones included
-- (their last value is kept, and kept within the edition). For the actions
-- that change an entry's Book or a Book's page count; not callable by members.
create function public.clamp_session_progress(p_entry_id uuid, p_page_count integer)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.reading_sessions
     set progress_page = public.clamp_progress_page(progress_page, p_page_count)
   where entry_id = p_entry_id
     and progress_page is distinct from public.clamp_progress_page(progress_page, p_page_count)
$$;

revoke all on function public.progress_page_fits(integer, integer) from public, anon;
grant execute on function public.progress_page_fits(integer, integer) to authenticated;
revoke all on function public.clamp_progress_page(integer, integer) from public, anon;
grant execute on function public.clamp_progress_page(integer, integer) to authenticated;
revoke all on function public.clamp_session_progress(uuid, integer) from public, anon, authenticated;

-- ------------------------------------------------------------ update_progress

-- Sets how far the member is in the entry's open read: a page or a percent,
-- exactly one. Replaces whatever was there (switching from a page to a percent
-- clears the page). Returns the open session.
create function public.update_progress(
  p_entry_id uuid,
  p_page     integer default null,
  p_percent  integer default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_page_count integer;
  v_session    public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locked, so progress from two devices lands one after the other.
  select b.page_count into v_page_count
    from public.library_entries e
    join public.books b on b.id = e.book_id
   where e.id = p_entry_id and e.member_id = v_member
     for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  select * into v_session from public.reading_sessions
   where entry_id = p_entry_id and outcome is null
     for update;
  if not found then
    raise exception 'not_reading' using errcode = '22023';
  end if;

  if num_nonnulls(p_page, p_percent) <> 1
     or (p_page is not null and not public.progress_page_fits(p_page, v_page_count))
     or p_percent not between 0 and 100 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  update public.reading_sessions
     set progress_page       = p_page,
         progress_percent    = p_percent,
         progress_updated_at = now()
   where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.update_progress(uuid, integer, integer) from public, anon;
grant execute on function public.update_progress(uuid, integer, integer) to authenticated;
