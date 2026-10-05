-- A Goodreads row for a book the member already has under another edition
-- (issue #104).
--
-- import_books recognised an entry by its key and by the Book the row found
-- (ISBN, source id, Catalogue id, a Manual book's title and author). After
-- Change edition the entry holds another edition than the one the file's ISBN
-- finds, so importing the file again added the book a second time. A row may
-- now carry the file's own `file_title` (the title without its series) and
-- `file_author` (the first author); when the member has a Book with the same
-- work title and an author with the same surname, the row is `in_library` and
-- her entry stays as it is. For a finished row that has an end day, her
-- entry's latest read must not have ended on another day (an entry without a
-- read, or a read without a day, still matches).
--
-- Deliberately simple: a member who changed the dates or the Book's title and
-- imports again may still get a second entry (accepted, her own edit). Rows
-- without `file_title` behave as before.

-- Text as the match compares it: accents stripped, lower case, `&` as "and",
-- every run of anything but letters and digits one space (the client's
-- `normalize`, data/import/readingTracker.ts).
create or replace function public.match_text(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select btrim(regexp_replace(
    lower(extensions.unaccent('extensions.unaccent'::regdictionary, replace(coalesce(p_text, ''), '&', ' and '))),
    '[^a-z0-9]+', ' ', 'g'))
$$;

-- The comparable name of the work behind a title: brackets (series, edition
-- notes) dropped and the part before a colon (the client's `workTitle`).
create or replace function public.work_title_key(p_title text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    nullif(public.match_text(split_part(
      regexp_replace(regexp_replace(coalesce(p_title, ''), '\s*[(\[][^()\[\]]*[)\]]', ' ', 'g'), '\s+', ' ', 'g'),
      ':', 1)), ''),
    public.match_text(p_title))
$$;

-- The last word of an author's name, normalised (the client's `surname`).
create or replace function public.author_surname_key(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(substring(public.match_text(p_name) from '[^ ]+$'), '')
$$;

revoke all on function public.match_text(text), public.work_title_key(text), public.author_surname_key(text)
  from public, anon, authenticated;

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
  v_title   text;
  v_surname text;
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

      -- Hers under another edition (after Change edition, say): the file's
      -- title and first author name a Book she has, and for a finished row
      -- the day it ended does not contradict her latest read. Looked for
      -- before the Book is found or made, so a match adds nothing anywhere.
      v_title   := public.work_title_key(v_row->>'file_title');
      v_surname := public.author_surname_key(v_row->>'file_author');
      if v_title <> '' then
        select e.id into v_entry
          from public.library_entries e
          join public.books b on b.id = e.book_id
         where e.member_id = v_member
           and public.work_title_key(b.title) = v_title
           and (v_surname = ''
                or exists (select 1 from unnest(b.authors) a where public.author_surname_key(a) = v_surname))
           and (v_status <> 'finished' or v_ended is null
                or not exists (select 1 from public.latest_session(e) s
                                where s.ended_on is not null and s.ended_on <> v_ended))
         order by e.added_at
         limit 1;
        if v_entry is not null then
          v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'in_library', 'entry_id', v_entry);
          continue;
        end if;
      end if;

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
