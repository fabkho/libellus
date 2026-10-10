-- Catalogue input (security assessment, October 2026: F1).
--
-- F1  A Catalogue Book's cover was whatever the first member sent: a tracking pixel for every
--     member who later looked at the Book, and any image of her choice. S1 put the host list
--     (`private.cover_shown`) on the surfaces that hand a Book to someone else's followers and
--     visitors only; the in-app reads still handed over any URL. Now the list lives in ONE function,
--     `private.cover_allowed(text)`, which `cover_shown` calls too, and
--       1. `books` refuses a cover off the list (a Manual book's cover is private to its owner and
--          stays free: `source = 'manual'`, the same exception the Book's other keys have),
--          the check added NOT VALID, the rows there are cleaned, then VALIDATEd;
--       2. `catalogue_book_for` (add_to_library, change_edition) and `import_book_for` (import_books)
--          add the Book without a cover that is off the list, and without its thumbhash and
--          colours, which describe that picture. The add does not fail.
--

-- ------------------------------------------------------------ 1. the one allow-list

-- https, and the whole host one of
--   covers.openlibrary.org   Open Library covers (data/openLibrary.ts)
--   *.mzstatic.com           Apple's artwork (data/apple.ts; is1-ssl, is2-ssl, ...)
--   books.fabkho.dev         the published Regal library (data/shelf.ts)
-- (what follows the host must be `/` or nothing, so `host@evil`, `host:80@evil`, `host.evil` and
-- `host#@evil` do not pass). Null is not allowed (a caller that accepts "no cover" tests for null).
create or replace function private.cover_allowed(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|([a-z0-9-]+\.)+mzstatic\.com)(/|$)',
    false)
$$;

revoke all on function private.cover_allowed(text) from public, anon, authenticated;
-- A check runs as the role that writes: the service role (maintenance, the Regal import) must be able to
-- call it. The members write only through definer functions, as the table's owner.
grant execute on function private.cover_allowed(text) to service_role;

-- Same rule, same grants as before (S1); the host list is no longer written here.
create or replace function private.cover_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select private.cover_allowed(p_book.cover_url)
$$;

revoke all on function private.cover_shown(public.books) from public, anon, authenticated;

-- ------------------------------------------------------ 2. what is stored, cleaned, then checked

-- A Catalogue Book's cover must be on the list (a check may call an immutable function). NOT VALID
-- first: from here on every write is checked, the rows there are only looked at after the cleaning.
alter table public.books
  add constraint books_cover_url_allowed
  check (source = 'manual' or cover_url is null or private.cover_allowed(cover_url)) not valid;

-- Rows from before: the cover goes with its thumbhash and colours.
update public.books
   set cover_url = null, cover_thumbhash = null, cover_dominant = null, cover_secondary = null
 where source <> 'manual' and cover_url is not null and not private.cover_allowed(cover_url);

alter table public.books validate constraint books_cover_url_allowed;

-- --------------------------------------------------------------- 3. the functions that add a Book

-- #41's catalogue_book_for (as 20261011090000_own_edition.sql: same signature, same behaviour),
-- now without a cover that is off the list.
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

  -- A cover off the allow-list (private.cover_allowed) is no cover: the Book is
  -- added without it, with the thumbhash and colours that describe it (F1).
  v_book.cover_url := nullif(btrim(v_book.cover_url), '');
  if v_book.cover_url is not null and not private.cover_allowed(v_book.cover_url) then
    v_book.cover_url       := null;
    v_book.cover_thumbhash := null;
    v_book.cover_dominant  := null;
    v_book.cover_secondary := null;
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

-- #40's import_book_for (as 20261011090100_import_own_edition.sql), the same change. A Manual
-- book's cover is private to its owner and stays as it is.
create or replace function public.import_book_for(p_member uuid, p_book_id text, p_book jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_book public.books;
  v_id   uuid;
begin
  if p_book_id is not null then
    -- A Book she can see: the Catalogue's, or her own Manual book.
    select id into v_id from public.books
     where id = p_book_id::uuid and (owner_id is null or owner_id = p_member);
    if v_id is null then
      raise exception 'book_invalid' using errcode = '22023';
    end if;
    return v_id;
  end if;

  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;
  v_book := jsonb_populate_record(null::public.books, p_book);
  -- Normalised as add_to_library does, so every client finds the same row.
  v_book.title   := nullif(btrim(v_book.title), '');
  v_book.isbn13  := nullif(upper(regexp_replace(v_book.isbn13, '[^0-9Xx]', '', 'g')), '');
  v_book.isbn10  := nullif(upper(regexp_replace(v_book.isbn10, '[^0-9Xx]', '', 'g')), '');
  v_book.authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(v_book.authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );
  if v_book.title is null or char_length(v_book.title) > 500 then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if v_book.source = 'manual' then
    -- No ISBN, no source: her own Manual book. One she made before with the
    -- same title and first author is the same book.
    if cardinality(v_book.authors) = 0
       or nullif(btrim(v_book.cover_url), '') !~ '^https://\S+$' then
      raise exception 'book_invalid' using errcode = '22023';
    end if;
    select id into v_id from public.books
     where owner_id = p_member
       and lower(title) = lower(v_book.title)
       and lower(coalesce(authors[1], '')) = lower(v_book.authors[1])
     order by created_at
     limit 1;
    if v_id is null then
      insert into public.books (title, authors, isbn13, isbn10, page_count, published_year, publisher,
                                language, format, cover_url, source, owner_id)
      values (v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
              v_book.published_year, v_book.publisher, nullif(lower(btrim(v_book.language)), ''),
              v_book.format, nullif(btrim(v_book.cover_url), ''), 'manual', p_member)
      returning id into v_id;
    end if;
    return v_id;
  end if;

  if v_book.source = 'apple' then
    v_book.format := coalesce(v_book.format, 'ebook');
  end if;

  -- As in catalogue_book_for: a cover off the allow-list goes, with its thumbhash and colours (F1).
  v_book.cover_url := nullif(btrim(v_book.cover_url), '');
  if v_book.cover_url is not null and not private.cover_allowed(v_book.cover_url) then
    v_book.cover_url       := null;
    v_book.cover_thumbhash := null;
    v_book.cover_dominant  := null;
    v_book.cover_secondary := null;
  end if;

  -- A Catalogue Book: found by a source, or (`import`) only the file knows it,
  -- and then its ISBN-13 is its key.
  if v_book.source is null
     or v_book.source not in ('apple', 'openlibrary', 'import')
     or coalesce(v_book.isbn13, v_book.apple_id, v_book.openlibrary_edition_key) is null
     or (v_book.source = 'import' and v_book.isbn13 is null) then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  -- An ISBN match wins over a source match: the same edition through another
  -- source is still the same Book.
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

  if v_id is null then
    -- Another member adding the same new Book at once: as in add_to_library.
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
    if v_id is null then
      raise exception 'book_conflict' using errcode = '40001';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.import_book_for(uuid, text, jsonb) from public, anon, authenticated;
