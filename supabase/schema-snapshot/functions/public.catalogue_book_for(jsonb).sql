CREATE OR REPLACE FUNCTION public.catalogue_book_for(p_book jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_book   public.books;
  v_id     uuid;
  v_member uuid := auth.uid();
  v_limit  constant integer := 200;
  v_count  integer;
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

  -- A cover off the allow-list (private.cover_allowed, 20261022010000) is no cover: the Book is
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
     or coalesce(v_book.isbn13, v_book.apple_id, v_book.openlibrary_edition_key) is null
     -- Open Library keys end up in a URL (F17): the table's check, refused politely.
     or v_book.openlibrary_edition_key !~ '^OL[1-9][0-9]{0,11}M$'
     or v_book.openlibrary_work_key !~ '^OL[1-9][0-9]{0,11}W$' then
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
      v_book.published_year, v_book.language, v_book.publisher, null,
      v_book.cover_url, v_book.cover_thumbhash, lower(v_book.cover_dominant),
      lower(v_book.cover_secondary), v_book.source, v_book.apple_id,
      v_book.openlibrary_edition_key, v_book.openlibrary_work_key, v_book.format
    )
    on conflict do nothing
    returning id into v_id;

    -- A new row: it counts against the member's day (not a service-role or test call, which has no member).
    if v_id is not null and v_member is not null then
      insert into private.catalogue_additions as a (member_id, day, n)
      values (v_member, current_date, 1)
      on conflict (member_id, day) do update set n = a.n + 1 where a.n < v_limit
      returning a.n into v_count;
      if v_count is null then
        raise exception 'catalogue_limit' using errcode = 'PT429';
      end if;
      delete from private.catalogue_additions where member_id = v_member and day < current_date - 7;
    end if;

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
$function$
;
