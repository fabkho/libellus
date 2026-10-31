CREATE OR REPLACE FUNCTION public.use_own_edition(p_entry_id uuid, p_book jsonb)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
