-- The Goodreads import, measured against real exports (issue #111).
--
-- import_books takes four more things per row, all optional, so a call
-- without them behaves as before:
--
--   extra_reads   integer 0 … 20   her earlier reads (Goodreads' Read Count
--                                  minus the one the row is): that many
--                                  finished sessions without dates, written
--                                  before the row's own so it stays the latest
--   outcome       'abandoned'      a did-not-finish shelf (#64): the closed
--                                  session is abandoned, not finished, and
--                                  carries no rating
--   page_count    integer          the file's page count: her own page count
--                                  for the entry (page_count_override) when
--                                  the edition found says another, or nothing
--   collections   text[] as json   her other Goodreads shelves she chose to
--                                  keep: each a Collection of hers (found by
--                                  name in any case, or made at the end of her
--                                  list), with the entry on it
--
-- Collections are filled for a row that was added, imported before or found
-- in her Library (importing again with shelves chosen puts the entries there);
-- the other three only shape a new entry.
--
-- And one fix: two rows of one file for the same work are two editions she
-- shelved (an English and a German read of the same novel). The title match
-- (#104) took the second for the first and left it out. A row may now name
-- the keys of the file's other rows of its work:
--
--   other_keys    text[] as json   an entry imported from one of these is
--                                  never taken for this row by its title
--
-- Only the file knows which rows belong together: a Book Id that changed
-- since the last export (she switched editions on Goodreads) is still matched
-- by title, as before.
--
-- New refusals per row (22023): `session_invalid` for extra reads or an
-- abandoned outcome where they cannot be (Want to read; a rated abandoned
-- read), `collections_invalid` for a collections value that is no array of names.

-- Puts one entry on the member's Collections by name, making the ones she
-- does not have yet. Names as Collections store them (collection_name); one
-- that is empty or too long is passed over. Only import_books calls it.
create or replace function public.import_place_in_collections(p_member uuid, p_entry uuid, p_names jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_value      jsonb;
  v_name       text;
  v_collection uuid;
begin
  if p_names is null or jsonb_typeof(p_names) = 'null' then
    return;
  end if;
  if jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 50 then
    raise exception 'collections_invalid' using errcode = '22023';
  end if;
  for v_value in select value from jsonb_array_elements(p_names) loop
    if jsonb_typeof(v_value) <> 'string' then
      raise exception 'collections_invalid' using errcode = '22023';
    end if;
    v_name := public.collection_name(v_value #>> '{}');
    continue when v_name is null;
    -- As create_collection: one member's new Collections queue up for their positions.
    perform pg_advisory_xact_lock(hashtext('collections:' || p_member::text));
    select id into v_collection from public.collections
     where member_id = p_member and lower(name) = lower(v_name);
    if v_collection is null then
      insert into public.collections (member_id, name, position)
      values (p_member, v_name,
              coalesce((select max(position) from public.collections where member_id = p_member), 0) + 1)
      returning id into v_collection;
    end if;
    insert into public.collection_entries (collection_id, entry_id, position)
    values (v_collection, p_entry,
            coalesce((select max(position) from public.collection_entries where collection_id = v_collection), 0) + 1)
    on conflict (collection_id, entry_id) do nothing;
  end loop;
end;
$$;

revoke all on function public.import_place_in_collections(uuid, uuid, jsonb) from public, anon, authenticated;

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
  v_outcome public.session_outcome;
  v_extra   integer;
  v_pages   integer;
  v_n       integer;
  v_others  text[];
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
        perform public.import_place_in_collections(v_member, v_entry, v_row->'collections');
        v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'imported', 'entry_id', v_entry);
        continue;
      end if;

      v_status  := coalesce(v_row->>'status', 'want_to_read')::public.entry_status;
      v_started := (v_row->>'started_on')::date;
      v_ended   := (v_row->>'ended_on')::date;
      v_rating  := (v_row->>'rating')::integer;
      v_review  := nullif(regexp_replace(v_row->>'review', '^\s+|\s+$', '', 'g'), '');
      v_added   := (v_row->>'added_on')::date;
      v_outcome := coalesce(v_row->>'outcome', 'finished')::public.session_outcome;
      v_extra   := coalesce((v_row->>'extra_reads')::integer, 0);
      v_pages   := (v_row->>'page_count')::integer;
      v_others  := coalesce((select array_agg(value) from jsonb_array_elements_text(
                     case when jsonb_typeof(v_row->'other_keys') = 'array' then v_row->'other_keys' else '[]' end)), '{}');
      if v_extra not between 0 and 20 then
        raise exception 'session_invalid' using errcode = '22023';
      end if;

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
           -- The file's other rows of this work are other editions she shelved, never this one.
           and (e.import_key is null or not (e.import_key = any (v_others)))
           and public.work_title_key(b.title) = v_title
           and (v_surname = ''
                or exists (select 1 from unnest(b.authors) a where public.author_surname_key(a) = v_surname))
           and (v_status <> 'finished' or v_ended is null
                or not exists (select 1 from public.latest_session(e) s
                                where s.ended_on is not null and s.ended_on <> v_ended))
         order by e.added_at
         limit 1;
        if v_entry is not null then
          perform public.import_place_in_collections(v_member, v_entry, v_row->'collections');
          v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'in_library', 'entry_id', v_entry);
          continue;
        end if;
      end if;

      v_book_id := public.import_book_for(v_member, v_row->>'book_id', v_row->'book');

      -- Already hers: her entry stays as it is.
      select id into v_entry from public.library_entries
       where member_id = v_member and book_id = v_book_id;
      if v_entry is not null then
        perform public.import_place_in_collections(v_member, v_entry, v_row->'collections');
        v_results := v_results || jsonb_build_object('key', v_key, 'outcome', 'in_library', 'entry_id', v_entry);
        continue;
      end if;

      -- Her page count when the edition says another (or none); a value out
      -- of range is no page count.
      if v_pages not between 1 and 99999
         or v_pages is not distinct from (select page_count from public.books where id = v_book_id) then
        v_pages := null;
      end if;

      insert into public.library_entries (member_id, book_id, import_key, page_count_override, added_at)
      values (
        v_member, v_book_id, v_key, v_pages,
        -- Midday UTC of the day it was added, so it is that day in every time zone near Europe and the Americas.
        coalesce(least((v_added + time '12:00') at time zone 'UTC', now()), now())
      )
      returning id into v_entry;

      if v_status = 'want_to_read' then
        if v_started is not null or v_ended is not null or v_rating is not null or v_review is not null
           or v_extra > 0 or v_row->>'outcome' is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
      elsif v_status = 'reading' then
        if v_started is null then
          raise exception 'date_invalid' using errcode = '22023';
        end if;
        if v_ended is not null or v_rating is not null or v_review is not null or v_row->>'outcome' is not null then
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
        if v_outcome = 'abandoned' and v_rating is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
        if char_length(v_review) > 10000 then
          raise exception 'review_too_long' using errcode = '22023';
        end if;
        insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review, import_key)
        values (v_entry, v_started, v_ended, v_outcome, v_rating, v_review, v_key);
      end if;

      -- Her earlier reads, finished and undated, `<key>#2` …: made a second
      -- apart before the row's own read, so it stays the latest (latest_session
      -- breaks ties on created_at).
      for v_n in 1 .. v_extra loop
        insert into public.reading_sessions (entry_id, outcome, import_key, created_at)
        values (v_entry, 'finished', v_key || '#' || (v_n + 1), now() - make_interval(secs => v_extra - v_n + 1));
      end loop;

      perform public.import_place_in_collections(v_member, v_entry, v_row->'collections');

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
