-- Importing a Goodreads library export in the app (issue #40).
--
-- A member picks her Goodreads CSV (or the Goodreads-compatible CSV a Fable
-- export extension writes) on /import. The client reads the file, looks every
-- row's edition up the way search does (the Catalogue, Apple Books,
-- OpenLibrary) and resolves its cover; this function writes the result, a few
-- rows per call, each row in its own savepoint so one bad row never undoes the
-- others:
--
--   import_books(p_rows jsonb) → jsonb, one result per row, in order:
--     { "key", "outcome", "entry_id"?, "error"? }
--
-- A row is { key, book_id | book, status, started_on, ended_on, rating,
-- review, added_on }:
--   key       `goodreads:<Book Id>`: the row's import key (#17's columns),
--             stored on the entry and its session.
--   book_id   a Book the member can see (a Catalogue Book, or her own Manual
--             book) that the lookup found; or
--   book      a snapshot as add_to_library takes it: `apple` / `openlibrary`
--             (found by a source but not in the Catalogue yet), `import` (no
--             source knows the edition: the file's own fields, keyed by its
--             ISBN-13, like #17's), or `manual` (no ISBN either: a Manual book,
--             private to the member, like #13's).
--   status    want_to_read | reading | finished, with the session it needs:
--             reading → started_on; finished → ended_on if known (an import
--             may not know the day), rating 1–20 quarters, review.
--   added_on  the day the book entered her Goodreads Library (Date Added).
--
-- Outcomes:
--   added       a new entry (and its session)
--   imported    an entry with this key exists already: importing the same
--               file twice adds nothing
--   in_library  the member has this Book already (made in the app, or another
--               row of the file found the same edition): her entry stays as it
--               is, no second session
--   failed      nothing written for this row; `error` says why (the refusals of
--               add_to_library and the session actions, `key_invalid`,
--               `book_invalid`, `row_invalid` for anything else)
--
-- The same rules as everywhere: the Status is derived from the session, a
-- Rating only on a finished read, no day in the future, the end not before the
-- start (reading_sessions' checks and triggers). Members still cannot write
-- either table, only call this.

-- -------------------------------------------------- the Book a row stands for

-- Finds or adds the Book of one row. Private: only import_books calls it, as
-- the member's own call (p_member is auth.uid()).
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
    if cardinality(v_book.authors) = 0 then
      raise exception 'book_invalid' using errcode = '22023';
    end if;
    select id into v_id from public.books
     where owner_id = p_member
       and lower(title) = lower(v_book.title)
       and lower(coalesce(authors[1], '')) = lower(v_book.authors[1])
     order by created_at
     limit 1;
    if v_id is null then
      insert into public.books (title, authors, isbn13, isbn10, page_count, published_year, publisher, source, owner_id)
      values (v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
              v_book.published_year, v_book.publisher, 'manual', p_member)
      returning id into v_id;
    end if;
    return v_id;
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
    if v_id is null then
      raise exception 'book_conflict' using errcode = '40001';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.import_book_for(uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------- import_books

create or replace function public.import_books(p_rows jsonb)
returns jsonb
language plpgsql
security definer
-- pg_catalog first: a security-definer body must not pick up a function someone
-- shadowed in public.
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_row     jsonb;
  v_key     text;
  v_status  public.entry_status;
  v_book_id uuid;
  v_entry   uuid;
  v_added   date;
  v_started date;
  v_ended   date;
  v_rating  integer;
  v_review  text;
  v_results jsonb := '[]'::jsonb;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  -- A few rows per call, so each call stays short and the screen can count.
  if jsonb_array_length(p_rows) > 100 then
    raise exception 'too_many_rows' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_key := v_row->>'key';
    begin
      if jsonb_typeof(v_row) <> 'object' or v_key is null or v_key !~ '^[a-z]+:\S+$' then
        raise exception 'key_invalid' using errcode = '22023';
      end if;

      -- Imported before: the same file again adds nothing.
      select id into v_entry from public.library_entries
       where member_id = v_member and import_key = v_key;
      if v_entry is not null then
        v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'imported', 'entry_id', v_entry);
        continue;
      end if;

      v_status  := coalesce(v_row->>'status', 'want_to_read')::public.entry_status;
      v_started := (v_row->>'started_on')::date;
      v_ended   := (v_row->>'ended_on')::date;
      v_rating  := (v_row->>'rating')::integer;
      v_review  := nullif(regexp_replace(v_row->>'review', '^\s+|\s+$', '', 'g'), '');
      v_added   := (v_row->>'added_on')::date;

      v_book_id := public.import_book_for(v_member, v_row->>'book_id', v_row->'book');

      -- Already hers: her entry stays as it is.
      select id into v_entry from public.library_entries
       where member_id = v_member and book_id = v_book_id;
      if v_entry is not null then
        v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'in_library', 'entry_id', v_entry);
        continue;
      end if;

      insert into public.library_entries (member_id, book_id, import_key, added_at)
      values (
        v_member, v_book_id, v_key,
        -- Midday UTC of the day it was added, so it is that day in every time zone near Europe and the Americas.
        coalesce(least((v_added + time '12:00') at time zone 'UTC', now()), now())
      )
      returning id into v_entry;

      if v_status = 'want_to_read' then
        if v_started is not null or v_ended is not null or v_rating is not null or v_review is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
      elsif v_status = 'reading' then
        if v_started is null then
          raise exception 'date_invalid' using errcode = '22023';
        end if;
        if v_ended is not null or v_rating is not null or v_review is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
        insert into public.reading_sessions (entry_id, started_on, import_key)
        values (v_entry, v_started, v_key);
      else
        -- Finished. An import may not know the day it ended: a finished read
        -- without dates is allowed (past reads).
        if v_started is not null and v_ended is not null and v_ended < v_started then
          raise exception 'ended_before_started' using errcode = '22023';
        end if;
        if v_rating is not null and v_rating not between 1 and 20 then
          raise exception 'rating_invalid' using errcode = '22023';
        end if;
        if char_length(v_review) > 10000 then
          raise exception 'review_too_long' using errcode = '22023';
        end if;
        insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review, import_key)
        values (v_entry, v_started, v_ended, 'finished', v_rating, v_review, v_key);
      end if;

      v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'added', 'entry_id', v_entry);
    exception when others then
      -- Only this row is undone (the block is its savepoint).
      v_results := v_results || jsonb_build_object(
        'key', v_key,
        'outcome', 'failed',
        'error', case when sqlstate in ('22023', '40001', '42501') then sqlerrm else 'row_invalid' end
      );
    end;
  end loop;

  return v_results;
end;
$$;

revoke all on function public.import_books(jsonb) from public, anon;
grant execute on function public.import_books(jsonb) to authenticated;
