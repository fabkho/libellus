-- Catalogue Books from the Fable import can be added by every member (#17).
--
-- The import (web/scripts/import-fable.ts) stores an imported Book with its
-- real origin wherever it has one — `apple` with Apple's id when Apple has the
-- edition by its ISBN, `openlibrary` with the edition key when only OpenLibrary
-- has it — so search and add_to_library treat it like any other Catalogue
-- Book. A few editions neither knows stay `source = 'import'`. Search (#12)
-- shows them too, and adding one sent `source: 'import'`, which add_to_library
-- refused as `book_invalid`. This replaces add_to_library (#9's version, same
-- signature, same behaviour otherwise) so an `import` snapshot is accepted when
-- it finds its Catalogue row by ISBN-13 or a source id, and refused when it
-- would create one: only the import makes `import` Books. Manual books stay
-- private as before (add_to_library only ever looks at Books without an owner).

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
  v_book   public.books;
  v_id     uuid;
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
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
  -- a member may add it — but only as the Catalogue row it is: an `import`
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
