-- "My edition isn't listed" (Change edition): a Book's format, the member's own
-- format for her entry, and her own edition.
--
-- A member's physical copy is not always among the editions Change edition
-- lists. She can now look its ISBN up in every source (a client matter: the
-- edition found is a Catalogue Book like any other and goes through
-- `change_edition`), or, when no source knows it, make the edition herself:
--
--   use_own_edition(p_entry_id, p_book) → the entry
--
-- Her own edition is a Manual book (#13): `source = 'manual'`, owned by her,
-- private (the `books_readable` policy shows it to its owner only), never in
-- the Catalogue (the Catalogue's unique indexes and `catalogue_book_for` leave
-- owned rows out), found by her own search like her other Manual books. The
-- entry moves to it as `change_edition` moves an entry: the same row, so its
-- reads, Ratings, reviews, Collections and progress stay; a progress page past
-- the new page count is cut back (#39, #60's own total counts first); a Manual
-- book left behind is deleted.
--
-- Formats. Sources say little about whether an edition is printed or not
-- (Apple sells ebooks; OpenLibrary's `physical_format` is free text and mostly
-- empty), and the member wants physical against ebook right:
--
--   books.format                   hardcover | paperback | ebook | audiobook, null = unknown
--   library_entries.format_override her own word on her entry's format, null = the Book's
--
-- `books.format` is what the source said, kept with the first snapshot like
-- every other field; Apple's editions are ebooks. A Catalogue Book is shared,
-- so the member's correction is never written into it: it is her entry's
-- `format_override`, private like the rest of her entry. The format that
-- counts is `coalesce(library_entries.format_override, books.format)`. An
-- override equal to the Book's format is stored as none, so it follows the
-- Book. It is about the edition, not the reads: moving the entry to another
-- edition replaces it (with the format sent along, or none).
--
--   set_entry_format(p_entry_id, p_format)          her format for the edition she has
--   change_edition(p_entry_id, p_book, p_format)    #41's, with the format she picked for it
--
-- Like Change edition these need the connection (the client says "Offline"
-- instead); they never wait in the outbox (#93).
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in        42501  no member behind the call
--   entry_not_found      P0002  no such entry in this member's Library
--   book_invalid         22023  an own edition without a format, with a title,
--                              author, page count, year, language, publisher
--                              or cover that cannot be stored (a cover must be
--                              an https URL)
--   isbn_invalid         22023  an ISBN whose check digit does not add up
--   edition_in_library   23505  change_edition: she has that edition as another entry

-- ------------------------------------------------------------ the columns

create type public.book_format as enum ('hardcover', 'paperback', 'ebook', 'audiobook');

alter table public.books add column format public.book_format;
comment on column public.books.format is
  'The edition''s format as its source said it (Apple''s are ebooks; OpenLibrary''s physical_format, read), '
  'or as the member said it for her own edition. Null = unknown.';

-- What the Catalogue holds from Apple was always an ebook.
update public.books set format = 'ebook' where source = 'apple' and format is null;

alter table public.library_entries add column format_override public.book_format;
comment on column public.library_entries.format_override is
  'The member''s own word on the format of her entry''s edition; null = the Book''s format. '
  'Never equal to the Book''s format (then it is null). Set through set_entry_format and change_edition.';

-- ----------------------------------------------------------- isbn_valid

-- True for an ISBN-13 (978/979) or an ISBN-10 whose check digit adds up.
create function public.isbn_valid(p_isbn text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_sum integer := 0;
begin
  if p_isbn ~ '^97[89][0-9]{10}$' then
    for i in 1..13 loop
      v_sum := v_sum + substr(p_isbn, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
    end loop;
    return v_sum % 10 = 0;
  elsif p_isbn ~ '^[0-9]{9}[0-9X]$' then
    for i in 1..10 loop
      v_sum := v_sum + (case when substr(p_isbn, i, 1) = 'X' then 10 else substr(p_isbn, i, 1)::integer end) * (11 - i);
    end loop;
    return v_sum % 11 = 0;
  end if;
  return false;
end;
$$;

revoke all on function public.isbn_valid(text) from public, anon, authenticated;

-- ------------------------------------------------- catalogue_book_for

-- #41's catalogue_book_for (same signature, same behaviour), now keeping the
-- snapshot's format; an Apple snapshot without one is an ebook.
create or replace function public.catalogue_book_for(p_book jsonb)
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
  if v_book.source = 'apple' then
    v_book.format := coalesce(v_book.format, 'ebook');
  end if;

  -- Only what search finds enters this way (see #41): Manual books have their
  -- own paths, and an `import` snapshot must match a Catalogue Book.
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
      apple_id, openlibrary_edition_key, openlibrary_work_key, format
    ) values (
      v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
      v_book.published_year, v_book.language, v_book.publisher, v_book.description,
      v_book.cover_url, v_book.cover_thumbhash, lower(v_book.cover_dominant),
      lower(v_book.cover_secondary), v_book.source, v_book.apple_id,
      v_book.openlibrary_edition_key, v_book.openlibrary_work_key, v_book.format
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

-- ------------------------------------------------------- move_entry_to

-- What changing an entry's edition does, once the entry is locked and the new
-- Book is known: refuses an edition she has as another entry, points the
-- entry at the Book with the format she said (none when it is the Book's),
-- cuts progress back to the page count that counts, deletes her Manual book
-- left behind. Not callable by members, only through the actions that use it.
create function public.move_entry_to(p_entry public.library_entries, p_book_id uuid, p_format public.book_format)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry      public.library_entries := p_entry;
  v_old        public.books;
  v_new        public.books;
begin
  if exists (
    select 1 from public.library_entries
     where member_id = v_entry.member_id and book_id = p_book_id and id <> v_entry.id
  ) then
    raise exception 'edition_in_library' using errcode = '23505';
  end if;

  select * into v_old from public.books where id = v_entry.book_id;
  select * into v_new from public.books where id = p_book_id;

  begin
    update public.library_entries
       set book_id = p_book_id,
           edition_changed_at = now(),
           format_override = case when p_format is distinct from v_new.format then p_format end
     where id = v_entry.id
    returning * into v_entry;
  exception when unique_violation then
    -- The same edition added on another device a moment ago.
    raise exception 'edition_in_library' using errcode = '23505';
  end;

  -- The member's own total (#60) when she set one, else the new edition's.
  perform public.clamp_session_progress(v_entry.id, coalesce(v_entry.page_count_override, v_new.page_count));

  -- Her Manual book, now used by nothing: gone, so her search never shows the stale copy.
  if v_old.owner_id = v_entry.member_id
     and not exists (select 1 from public.library_entries where book_id = v_old.id) then
    delete from public.books where id = v_old.id;
  end if;

  return v_entry;
end;
$$;

revoke all on function public.move_entry_to(public.library_entries, uuid, public.book_format)
  from public, anon, authenticated;

-- ----------------------------------------------------------- change_edition

-- #41's change_edition with the format she picked for the new edition (null:
-- the Book's own). Picking the edition the entry already has still changes
-- nothing (her format for it is set_entry_format's).
drop function public.change_edition(uuid, jsonb);

create function public.change_edition(p_entry_id uuid, p_book jsonb, p_format public.book_format default null)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_book_id uuid;
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

  return public.move_entry_to(v_entry, v_book_id, p_format);
end;
$$;

revoke all on function public.change_edition(uuid, jsonb, public.book_format) from public, anon;
grant execute on function public.change_edition(uuid, jsonb, public.book_format) to authenticated;

-- --------------------------------------------------------- set_entry_format

-- Her format for the edition her entry has (null: the Book's own). Returns the entry.
create function public.set_entry_format(p_entry_id uuid, p_format public.book_format)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  update public.library_entries e
     set format_override = case when p_format is distinct from b.format then p_format end
    from public.books b
   where e.id = p_entry_id and e.member_id = v_member and b.id = e.book_id
  returning e.* into v_entry;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  return v_entry;
end;
$$;

revoke all on function public.set_entry_format(uuid, public.book_format) from public, anon;
grant execute on function public.set_entry_format(uuid, public.book_format) to authenticated;

-- ---------------------------------------------------------- use_own_edition

-- Makes the member's own edition of her entry's Book (a Manual book owned by
-- her) from `p_book` — the `books` columns by name, as change_edition takes
-- them: format (required), title and authors (blank: the entry's Book's),
-- isbn13 / isbn10, page_count, published_year, language, publisher, cover_url
-- (https only) with its thumbhash and colours — and moves the entry to it.
-- Returns the entry.
create function public.use_own_edition(p_entry_id uuid, p_book jsonb)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_current public.books;
  v_book    public.books;
  v_id      uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  select * into v_current from public.books where id = v_entry.book_id;

  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;
  v_book := jsonb_populate_record(null::public.books, p_book);

  v_book.title := coalesce(nullif(btrim(v_book.title), ''), v_current.title);
  v_book.authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(v_book.authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    v_current.authors
  );
  v_book.publisher := nullif(btrim(v_book.publisher), '');
  v_book.language := nullif(lower(btrim(v_book.language)), '');
  v_book.cover_url := nullif(btrim(v_book.cover_url), '');
  v_book.isbn13 := nullif(upper(regexp_replace(v_book.isbn13, '[\s-]', '', 'g')), '');
  v_book.isbn10 := nullif(upper(regexp_replace(v_book.isbn10, '[\s-]', '', 'g')), '');

  if v_book.format is null
     or char_length(v_book.title) > 500
     or cardinality(v_book.authors) = 0
     or v_book.page_count not between 1 and 99999
     or char_length(v_book.publisher) > 500
     or v_book.language !~ '^[a-z]{2,3}$'
     or v_book.cover_url !~ '^https://\S+$'
     or char_length(v_book.cover_url) > 2000 then
    raise exception 'book_invalid' using errcode = '22023';
  end if;
  if (v_book.isbn13 is not null and (v_book.isbn13 !~ '^97' or not public.isbn_valid(v_book.isbn13)))
     or (v_book.isbn10 is not null and not public.isbn_valid(v_book.isbn10)) then
    raise exception 'isbn_invalid' using errcode = '22023';
  end if;

  -- The year (1 … 2100) and the cover's colours are the table's to refuse.
  insert into public.books (
    title, authors, isbn13, isbn10, page_count, published_year, language, publisher,
    cover_url, cover_thumbhash, cover_dominant, cover_secondary, format, source, owner_id
  ) values (
    v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
    v_book.published_year, v_book.language, v_book.publisher,
    v_book.cover_url, case when v_book.cover_url is not null then v_book.cover_thumbhash end,
    case when v_book.cover_url is not null then lower(v_book.cover_dominant) end,
    case when v_book.cover_url is not null then lower(v_book.cover_secondary) end,
    v_book.format, 'manual', v_member
  )
  returning id into v_id;

  return public.move_entry_to(v_entry, v_id, v_book.format);
end;
$$;

revoke all on function public.use_own_edition(uuid, jsonb) from public, anon;
grant execute on function public.use_own_edition(uuid, jsonb) to authenticated;
