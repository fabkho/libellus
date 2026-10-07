-- The import keeps formats and the member's own edition (Choose edition's
-- "My edition isn't listed").
--
-- #40's import_book_for (same signature, same behaviour) now stores what
-- 20261011090000_own_edition added to a Book: a Catalogue Book's format (an
-- Apple edition without one is an ebook), and for a Manual book (a row only
-- the file knows, or the edition she made herself in Choose edition) its
-- format, language and cover too. A cover must be an https URL, as for
-- use_own_edition. Nothing about finding the Book changes: a Manual book of hers
-- with the same title and first author is still the same book.

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
