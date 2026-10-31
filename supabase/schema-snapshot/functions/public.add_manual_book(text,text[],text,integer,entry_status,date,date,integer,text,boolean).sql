CREATE OR REPLACE FUNCTION public.add_manual_book(p_title text, p_authors text[], p_isbn text DEFAULT NULL::text, p_page_count integer DEFAULT NULL::integer, p_status entry_status DEFAULT 'want_to_read'::entry_status, p_started_on date DEFAULT NULL::date, p_ended_on date DEFAULT NULL::date, p_rating integer DEFAULT NULL::integer, p_review text DEFAULT NULL::text, p_review_spoilers boolean DEFAULT false)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
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
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review, p_review_spoilers);

  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$function$
;
