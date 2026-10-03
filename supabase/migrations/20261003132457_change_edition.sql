-- Changing the edition of a Library entry (issue #41; issue #1, Out of Scope,
-- item 5).
--
-- A Library entry points at one Book, one edition. The member may point it at
-- another edition of the same work (another language, another cover, another
-- page count): the entry stays the same row, so its reading sessions, their
-- Ratings and reviews, its Collection memberships and its import key stay with
-- it. Only `book_id` changes. This is also how a member fixes a wrong or
-- missing Cover.
--
--   change_edition(p_entry_id, p_book) → the entry
--
-- `p_book` is a snapshot as add_to_library takes it (a Catalogue Book found
-- again by its ISBN-13 or source id, or one a source found that enters the
-- Catalogue now). Finding or adding that Book is add_to_library's own code,
-- moved into `catalogue_book_for` below so both actions run the same rule;
-- add_to_library is redefined here to call it (same signature, same
-- behaviour). The client resolves a new Book's Cover before the call, as it
-- does for an add.
--
-- Rules:
--   * only the member's own entry (`entry_not_found` otherwise); other
--     members' entries are never touched;
--   * the new edition must not be another of her entries already
--     (`edition_in_library`): two entries for one Book is what the
--     `library_entries_once_per_book` constraint forbids, and the member is
--     told so instead of seeing a conflict;
--   * picking the edition the entry already has changes nothing;
--   * progress pages (#39) are clamped to the new page count with
--     `clamp_session_progress`, the rule #39 left for this action: a page
--     past the new edition's last page becomes its last page; a smaller page,
--     a percentage, or a Book without a page count keep what they have;
--   * the Status is untouched: it follows from the sessions, which stay.
--
-- A Manual book left behind: a Manual book is private to its member and only
-- reachable through her entry (and her search). Once the entry points at a
-- Catalogue edition nothing uses it any more, and keeping it would leave a
-- second, stale copy of the same book in her search. So the old Manual book is
-- deleted when no entry of hers still points at it. A Catalogue Book left
-- behind always stays (it is shared; other members may hold it, and it is
-- what search finds).
--
-- `edition_changed_at` records that the member chose the entry's edition. The
-- owner's Fable import (web/scripts/fable/write.ts) moves an imported entry to
-- the edition its overrides name; on an entry the member re-pointed in the app
-- it leaves the Book alone instead, so a rerun never moves it back.
--
-- Refusals, as `raise` messages with stable SQLSTATEs (the ones the other
-- actions use, plus one):
--   not_signed_in        42501  no member behind the call
--   entry_not_found      P0002  no such entry in this member's Library
--   book_invalid         22023  a snapshot that cannot be a Catalogue Book
--                              (no title, no ISBN or source id, `manual`, or
--                              an `import` snapshot that matches no Book)
--   edition_in_library   23505  she already has that edition as another entry
--   book_conflict        40001  a concurrent add rolled back; retry

-- ------------------------------------------------------------- the column

alter table public.library_entries
  add column edition_changed_at timestamptz;

comment on column public.library_entries.edition_changed_at is
  'When the member last changed this entry''s edition (change_edition). Null when the entry '
  'still has the Book it was added with. The Fable import leaves the Book of such an entry alone.';

-- ------------------------------------------------- catalogue_book_for

-- The Catalogue Book for a snapshot: found by its ISBN-13, else by its Apple
-- id or OpenLibrary edition key, else added with this snapshot (the first
-- snapshot is kept). Refuses with `book_invalid` what cannot be a Catalogue
-- Book. add_to_library's rule, verbatim (#6, #9, #17); not callable by members,
-- only through the actions that use it.
create function public.catalogue_book_for(p_book jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_book public.books;
  v_id   uuid;
begin
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  v_book := jsonb_populate_record(null::public.books, p_book);
  -- Normalised here too, so every client finds the same row.
  v_book.title   := nullif(btrim(v_book.title), '');
  v_book.isbn13  := nullif(upper(regexp_replace(v_book.isbn13, '[^0-9Xx]', '', 'g')), '');
  v_book.isbn10  := nullif(upper(regexp_replace(v_book.isbn10, '[^0-9Xx]', '', 'g')), '');
  v_book.authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(v_book.authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );

  -- Only what search finds enters this way: Manual books (#13) have their own
  -- path, and so does the Fable import, which writes Catalogue Books as the
  -- service role. A Book the import wrote with source `import` (an edition
  -- neither Apple nor OpenLibrary knows) is found by search like any other, so
  -- a member may pick it — but only as the Catalogue row it is: an `import`
  -- snapshot that matches no Catalogue Book is refused, so no member invents one.
  if v_book.title is null
     or v_book.source is null
     or v_book.source not in ('apple', 'openlibrary', 'import')
     or coalesce(v_book.isbn13, v_book.apple_id, v_book.openlibrary_edition_key) is null then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  -- An ISBN match wins over a source match: the same edition found through
  -- another source is still the same Book.
  select id into v_id from public.books
   where owner_id is null and v_book.isbn13 is not null and isbn13 = v_book.isbn13;
  if v_id is null then
    select id into v_id from public.books
     where owner_id is null
       and ((v_book.apple_id is not null and apple_id = v_book.apple_id)
         or (v_book.openlibrary_edition_key is not null
             and openlibrary_edition_key = v_book.openlibrary_edition_key))
     limit 1;
  end if;

  if v_id is null and v_book.source = 'import' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if v_id is null then
    -- Two members adding the same new Book at once: the second insert waits for
    -- the first transaction, then does nothing, and the next statement (a new
    -- snapshot) finds the winner's row instead.
    insert into public.books (
      title, authors, isbn13, isbn10, page_count, published_year, language, publisher,
      description, cover_url, cover_thumbhash, cover_dominant, cover_secondary, source,
      apple_id, openlibrary_edition_key, openlibrary_work_key
    ) values (
      v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
      v_book.published_year, v_book.language, v_book.publisher, v_book.description,
      v_book.cover_url, v_book.cover_thumbhash, lower(v_book.cover_dominant),
      lower(v_book.cover_secondary), v_book.source, v_book.apple_id,
      v_book.openlibrary_edition_key, v_book.openlibrary_work_key
    )
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id from public.books
       where owner_id is null
         and ((v_book.isbn13 is not null and isbn13 = v_book.isbn13)
           or (v_book.apple_id is not null and apple_id = v_book.apple_id)
           or (v_book.openlibrary_edition_key is not null
               and openlibrary_edition_key = v_book.openlibrary_edition_key))
       limit 1;
    end if;
    -- Only if the winner rolled back in between; the member can simply retry.
    if v_id is null then
      raise exception 'book_conflict' using errcode = '40001';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.catalogue_book_for(jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------- add_to_library

-- #17's add_to_library (same signature, same behaviour), its Book step now
-- `catalogue_book_for`.
create or replace function public.add_to_library(
  p_book       jsonb,
  p_status     public.entry_status default 'want_to_read',
  p_started_on date default null,
  p_ended_on   date default null,
  p_rating     integer default null,
  p_review     text default null
)
returns public.library_entries
language plpgsql
security definer
-- pg_catalog first: a security-definer body must not pick up a function someone
-- shadowed in public.
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_id     uuid;
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  v_id := public.catalogue_book_for(p_book);

  begin
    insert into public.library_entries (member_id, book_id)
    values (v_member, v_id)
    returning * into v_entry;
  exception when unique_violation then
    raise exception 'already_in_library' using errcode = '23505';
  end;

  -- Raises on anything wrong with the dates, Rating or review, which undoes
  -- the entry (and a Book this call added) with it.
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review);

  -- The status the session gave it.
  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$$;

revoke all on function public.add_to_library(jsonb, public.entry_status, date, date, integer, text)
  from public, anon;
grant execute on function public.add_to_library(jsonb, public.entry_status, date, date, integer, text)
  to authenticated;

-- ----------------------------------------------------------- change_edition

-- Points one of the member's entries at another edition. Returns the entry.
create function public.change_edition(p_entry_id uuid, p_book jsonb)
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

  select page_count into v_page_count from public.books where id = v_book_id;
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
