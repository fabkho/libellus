-- The member's own page count for a read (issue #60).
--
-- An ebook's pages follow the font size, so "p. 212 of 480" can be wrong for
-- the member and `update_progress` refused a page past the edition's page
-- count. The member may now set her own total for an entry:
--
--   library_entries.page_count_override   integer, 1 … 99999, null = the edition's
--
-- Per Library entry (not per session): she reads the entry in one format, so the
-- total survives Finish, Read again and Start again, and every read of the
-- entry is measured against the same total. The edition's page count stays
-- the default; the page count that counts is
--
--   coalesce(library_entries.page_count_override, books.page_count)
--
-- (null when neither is known: any page is then accepted and a percentage is
-- what the app offers). An override equal to the edition's page count is stored
-- as no override, so a total that only repeats the edition's follows it when the
-- entry moves to another edition.
--
-- It is written through `update_progress`, in the same call as the progress,
-- so the page is validated against the total it is sent with:
--
--   update_progress(p_entry_id, p_page, p_percent, p_set_page_count, p_page_count)
--
-- `p_set_page_count` says the total is part of the call: then `p_page_count` is
-- the new override, or null to go back to the edition's. Left false (the
-- default) the total is not touched, which is how every call before this
-- one still works. With the total in the call the value may be left out (no
-- page, no percent): only the total changes and the read keeps its progress,
-- cut back to the new total when it was past it. Everything else is as it was:
-- the entry must have an open read (`not_reading`), a page must fit the page
-- count that counts, a percent is 0–100, and a total outside 1 … 99999 is
-- `progress_invalid`.
--
-- Whenever the page count that counts goes down, every read of the entry, closed
-- ones included, is cut back to it (`clamp_session_progress`, as Change edition
-- has always done); a total set higher again does not bring the old page back.
-- `change_edition` now clamps against the total when there is one: moving an
-- entry to another edition does not touch the member's own total.

alter table public.library_entries
  add column page_count_override integer,
  add constraint library_entries_page_count_override_range check (page_count_override between 1 and 99999);

comment on column public.library_entries.page_count_override is
  'The member''s own total pages for this entry (an ebook''s differ from the edition''s), 1 … 99999; '
  'null = the edition''s page count. Set only through update_progress; counts for every read of the entry.';

-- ------------------------------------------------------------ update_progress

-- Same function with the total added; a new signature, so the old one goes.
drop function public.update_progress(uuid, integer, integer);

-- Sets how far the member is in the entry's open read (a page or a percent,
-- exactly one, replacing what was there) and, when `p_set_page_count`, her own
-- total pages. Returns the open session.
create function public.update_progress(
  p_entry_id       uuid,
  p_page           integer default null,
  p_percent        integer default null,
  p_set_page_count boolean default false,
  p_page_count     integer default null
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_override   integer;
  v_book_count integer;
  v_page_count integer;
  v_session    public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- Locked, so progress from two devices lands one after the other.
  select e.page_count_override, b.page_count into v_override, v_book_count
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

  if p_set_page_count then
    if p_page_count is not null and p_page_count not between 1 and 99999 then
      raise exception 'progress_invalid' using errcode = '22023';
    end if;
    -- A total that only repeats the edition's is no override.
    v_override := case when p_page_count is not distinct from v_book_count then null else p_page_count end;
  end if;
  v_page_count := coalesce(v_override, v_book_count);

  if num_nonnulls(p_page, p_percent) > 1
     or (num_nonnulls(p_page, p_percent) = 0 and not p_set_page_count)
     or (p_page is not null and not public.progress_page_fits(p_page, v_page_count))
     or p_percent not between 0 and 100 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  if p_set_page_count then
    update public.library_entries set page_count_override = v_override where id = p_entry_id;
    perform public.clamp_session_progress(p_entry_id, v_page_count);
  end if;

  if num_nonnulls(p_page, p_percent) = 1 then
    update public.reading_sessions
       set progress_page       = p_page,
           progress_percent    = p_percent,
           progress_updated_at = now()
     where id = v_session.id
    returning * into v_session;
  else
    select * into v_session from public.reading_sessions where id = v_session.id;
  end if;
  return v_session;
end;
$$;

revoke all on function public.update_progress(uuid, integer, integer, boolean, integer) from public, anon;
grant execute on function public.update_progress(uuid, integer, integer, boolean, integer) to authenticated;

-- ----------------------------------------------------------- change_edition

-- #41's change_edition (same signature, same behaviour) clamping progress to the
-- page count that counts: the member's own total when she has one.
create or replace function public.change_edition(p_entry_id uuid, p_book jsonb)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member     uuid := auth.uid();
  v_entry      public.library_entries;
  v_old        public.books;
  v_book_id    uuid;
  v_page_count integer;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  -- Locked, so a progress update or a second change from another device lands
  -- after this one.
  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  v_book_id := public.catalogue_book_for(p_book);
  if v_book_id = v_entry.book_id then
    return v_entry;
  end if;

  if exists (
    select 1 from public.library_entries
     where member_id = v_member and book_id = v_book_id and id <> v_entry.id
  ) then
    raise exception 'edition_in_library' using errcode = '23505';
  end if;

  select * into v_old from public.books where id = v_entry.book_id;

  begin
    update public.library_entries
       set book_id = v_book_id,
           edition_changed_at = now()
     where id = v_entry.id
    returning * into v_entry;
  exception when unique_violation then
    -- The same edition added on another device a moment ago.
    raise exception 'edition_in_library' using errcode = '23505';
  end;

  -- The member's own total (when she set one) is the page count that counts, so
  -- a new edition's page count only matters while she has none.
  select coalesce(v_entry.page_count_override, page_count) into v_page_count
    from public.books where id = v_book_id;
  perform public.clamp_session_progress(v_entry.id, v_page_count);

  -- Her Manual book, now used by nothing: gone, so her search never shows the stale copy.
  if v_old.owner_id = v_member
     and not exists (select 1 from public.library_entries where book_id = v_old.id) then
    delete from public.books where id = v_old.id;
  end if;

  return v_entry;
end;
$$;

revoke all on function public.change_edition(uuid, jsonb) from public, anon;
grant execute on function public.change_edition(uuid, jsonb) to authenticated;
