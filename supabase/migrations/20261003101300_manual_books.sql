-- Manual books (issue #1, Manual books; issue #13).
--
-- A Manual book is a Book a member typed in by hand. It lives in `books` with
-- `source = 'manual'` and an `owner_id` (the table's `books_owner_iff_manual`
-- check ties the two together), and the `books_readable` policy already shows a
-- row with an owner to that owner only: no other member reads it, finds it in
-- search or can put it into a Library. What was missing is the way in. Members
-- never write `books` directly, so this is the sibling of `add_to_library`: one
-- call that makes the Book, owned by the caller, and puts it into the Library.
--
-- It is never part of the Catalogue: `add_to_library` only looks at Books
-- without an owner, and the partial unique indexes on ISBN and source ids leave
-- Manual books out, so two members typing in the same book never meet.

-- ----------------------------------------------------------- add_manual_book

-- Makes a Manual book owned by the caller and creates her entry for it. Returns
-- the entry. The title and at least one author are required; the ISBN (10 or 13
-- digits, hyphens and spaces allowed, the check digit must add up) and the page
-- count are optional. An ISBN-10 is also stored as its ISBN-13.
--
-- `p_status` is `want_to_read` for now, as for `add_to_library`; #9 lets both add
-- straight to Currently reading or Finished, with the session that implies.
--
-- Refusals, as `raise` messages with stable SQLSTATEs:
--   not_signed_in        42501  no member behind the call
--   status_unsupported   22023  a status this version cannot add with yet
--   book_invalid         22023  no title, no author, or a page count that is not positive
--   isbn_invalid         22023  an ISBN that is not 10 or 13 digits with a matching check digit
create or replace function public.add_manual_book(
  p_title      text,
  p_authors    text[],
  p_isbn       text default null,
  p_page_count integer default null,
  p_status     public.entry_status default 'want_to_read'
)
returns public.library_entries
language plpgsql
security definer
-- pg_catalog first: a security-definer body must not pick up a function someone
-- shadowed in public.
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
  if p_status is distinct from 'want_to_read' then
    raise exception 'status_unsupported' using errcode = '22023';
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

  insert into public.library_entries (member_id, book_id, status)
  values (v_member, v_book, p_status)
  returning * into v_entry;

  return v_entry;
end;
$$;

revoke all on function public.add_manual_book(text, text[], text, integer, public.entry_status)
  from public, anon;
grant execute on function public.add_manual_book(text, text[], text, integer, public.entry_status)
  to authenticated;
