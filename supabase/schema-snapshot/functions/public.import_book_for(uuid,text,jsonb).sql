CREATE OR REPLACE FUNCTION public.import_book_for(p_member uuid, p_book_id text, p_book jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
     or (v_book.source = 'import' and v_book.isbn13 is null)
     -- Open Library keys end up in a URL (F17): the table's check, refused politely.
     or v_book.openlibrary_edition_key !~ '^OL[1-9][0-9]{0,11}M$'
     or v_book.openlibrary_work_key !~ '^OL[1-9][0-9]{0,11}W$' then
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
$function$
;
