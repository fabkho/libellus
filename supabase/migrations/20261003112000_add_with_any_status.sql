-- Add with any status (issue #1, Library actions; issue #9).
--
-- `add_to_library` (#6) and `add_manual_book` (#13) only added *Want to read*.
-- A member logging a book she is reading now, or one she finished years ago,
-- should not have to add it and then start and finish it: both functions now
-- take the status the entry starts with and, for *Currently reading* and
-- *Finished*, the first Reading session, and create it in the same call as the
-- entry. The rules are those of start_reading and finish_reading (#7):
--
--   want_to_read      no session, so no dates, Rating or review
--   reading           `p_started_on` (required); nothing else
--   finished          `p_ended_on` (required), `p_started_on` (optional: a read
--                     logged after the fact may not know it), `p_rating`
--                     (quarters, 1–20, optional), `p_review` (optional)
--
-- No date is in the future and an end is never before its start, as for every
-- session. The entry's Status is still the database's: it follows from the
-- session this adds, and a client cannot write it.
--
-- Refusals add to those of the two functions (see their original migrations):
--   session_invalid        22023  dates, a Rating or a review that do not belong to the
--                                 status (dates on Want to read, a Rating on Currently reading …)
--   date_invalid           22023  a date the status needs is missing
--   date_in_future         22023  a date later than today, wherever on Earth today is latest
--   ended_before_started   22023  an end date before the start date
--   rating_invalid         22023  a Rating outside 1–20 quarters
--   review_too_long        22023  a review over 10,000 characters
-- and `status_unsupported` is no longer raised: every status can be added with.
--
-- The signatures grow, so the old ones are dropped (an overload would make a
-- call with only the old arguments ambiguous for PostgREST). Callers that name
-- their arguments, such as the collections function, are unaffected: every new
-- argument has a default.

-- ------------------------------------------------------ the first session

-- Checks the session an added entry starts with and creates it. Internal to
-- add_to_library and add_manual_book: members cannot call it.
create function public.add_first_session(
  p_entry_id   uuid,
  p_status     public.entry_status,
  p_started_on date,
  p_ended_on   date,
  p_rating     integer,
  p_review     text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
begin
  if p_status = 'want_to_read' then
    if p_started_on is not null or p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if p_status = 'reading' then
    if p_started_on is null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
    if p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    insert into public.reading_sessions (entry_id, started_on) values (p_entry_id, p_started_on);
    return;
  end if;

  -- finished
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_started_on is not null and p_ended_on < p_started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;
  insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review)
  values (p_entry_id, p_started_on, p_ended_on, 'finished', p_rating, v_review);
end;
$$;

revoke all on function public.add_first_session(uuid, public.entry_status, date, date, integer, text)
  from public, anon, authenticated;

-- ------------------------------------------------------------- add_to_library

drop function public.add_to_library(jsonb, public.entry_status);

-- As in #6 (finds or adds the Catalogue Book, creates the entry, returns it),
-- now with the status the entry starts with and its first session.
create function public.add_to_library(
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

  -- Only what search finds enters this way: Manual books (#13) and the Fable
  -- import have their own paths.
  if v_book.title is null
     or v_book.source is null
     or v_book.source not in ('apple', 'openlibrary')
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

-- ----------------------------------------------------------- add_manual_book

drop function public.add_manual_book(text, text[], text, integer, public.entry_status);

-- As in #13 (makes the Manual book, owned by the caller, and her entry for it),
-- now with the status the entry starts with and its first session.
create function public.add_manual_book(
  p_title      text,
  p_authors    text[],
  p_isbn       text default null,
  p_page_count integer default null,
  p_status     public.entry_status default 'want_to_read',
  p_started_on date default null,
  p_ended_on   date default null,
  p_rating     integer default null,
  p_review     text default null
)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_title   text := nullif(btrim(p_title), '');
  v_authors text[];
  v_isbn    text := nullif(upper(regexp_replace(coalesce(p_isbn, ''), '[\s-]', '', 'g')), '');
  v_isbn13  text;
  v_isbn10  text;
  v_sum     integer;
  v_book    uuid;
  v_entry   public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  v_authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(p_authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );
  if v_title is null or char_length(v_title) > 500 or cardinality(v_authors) = 0
     or p_page_count <= 0 then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if v_isbn is not null then
    if v_isbn ~ '^97[89][0-9]{10}$' then
      v_sum := 0;
      for i in 1..13 loop
        v_sum := v_sum + substr(v_isbn, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
      end loop;
      if v_sum % 10 <> 0 then
        raise exception 'isbn_invalid' using errcode = '22023';
      end if;
      v_isbn13 := v_isbn;
    elsif v_isbn ~ '^[0-9]{9}[0-9X]$' then
      v_sum := 0;
      for i in 1..10 loop
        v_sum := v_sum + (case when substr(v_isbn, i, 1) = 'X' then 10 else substr(v_isbn, i, 1)::integer end)
                         * (11 - i);
      end loop;
      if v_sum % 11 <> 0 then
        raise exception 'isbn_invalid' using errcode = '22023';
      end if;
      v_isbn10 := v_isbn;
      -- The same edition as an ISBN-13: 978, the nine digits, a new check digit.
      v_sum := 0;
      for i in 1..12 loop
        v_sum := v_sum + substr('978' || substr(v_isbn, 1, 9), i, 1)::integer
                         * case when i % 2 = 1 then 1 else 3 end;
      end loop;
      v_isbn13 := '978' || substr(v_isbn, 1, 9) || ((10 - v_sum % 10) % 10)::text;
    else
      raise exception 'isbn_invalid' using errcode = '22023';
    end if;
  end if;

  insert into public.books (title, authors, isbn13, isbn10, page_count, source, owner_id)
  values (v_title, v_authors, v_isbn13, v_isbn10, p_page_count, 'manual', v_member)
  returning id into v_book;

  insert into public.library_entries (member_id, book_id)
  values (v_member, v_book)
  returning * into v_entry;

  -- Raises on anything wrong with the dates, Rating or review, which undoes the
  -- Book and the entry with it.
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review);

  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$$;

revoke all on function public.add_manual_book(
  text, text[], text, integer, public.entry_status, date, date, integer, text
) from public, anon;
grant execute on function public.add_manual_book(
  text, text[], text, integer, public.entry_status, date, date, integer, text
) to authenticated;
