CREATE OR REPLACE FUNCTION public.import_books(p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  v_earlier jsonb;
  v_read    jsonb;
  v_read_start date;
  v_read_end   date;
  v_count   integer;
  v_dated   integer;
  v_progress jsonb;
  v_prog_num numeric;
  v_prog_page    integer;
  v_prog_percent integer;
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
      v_earlier := coalesce(v_row->'earlier_reads', '[]'::jsonb);
      if jsonb_typeof(v_earlier) = 'null' then
        v_earlier := '[]'::jsonb;
      end if;
      -- How far she was (a Hardcover zip's open and abandoned reads): { "page": n } or { "percent": n }, one of the two, whole
      -- numbers in range, and only where a session can hold one (Currently reading, or abandoned). Checked before anything is written.
      v_progress := v_row->'progress';
      v_prog_page := null;
      v_prog_percent := null;
      if v_progress is not null and jsonb_typeof(v_progress) <> 'null' then
        if jsonb_typeof(v_progress) <> 'object'
           or (select count(*) from jsonb_object_keys(v_progress)) <> 1
           or not (v_progress ? 'page' or v_progress ? 'percent')
           or jsonb_typeof(coalesce(v_progress->'page', v_progress->'percent')) <> 'number' then
          raise exception 'progress_invalid' using errcode = '22023';
        end if;
        v_prog_num := (coalesce(v_progress->>'page', v_progress->>'percent'))::numeric;
        if v_prog_num <> trunc(v_prog_num)
           or (v_progress ? 'page' and v_prog_num not between 0 and 99999)
           or (v_progress ? 'percent' and v_prog_num not between 0 and 100) then
          raise exception 'progress_invalid' using errcode = '22023';
        end if;
        if not (v_status = 'reading' or (v_status = 'finished' and v_outcome = 'abandoned')) then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
        if v_progress ? 'page' then
          v_prog_page := v_prog_num::integer;
        else
          v_prog_percent := v_prog_num::integer;
        end if;
      end if;
      if v_extra not between 0 and 20 or jsonb_typeof(v_earlier) <> 'array' then
        raise exception 'session_invalid' using errcode = '22023';
      end if;
      if jsonb_array_length(v_earlier) + v_extra > 20
         or exists (select 1 from jsonb_array_elements(v_earlier) r where jsonb_typeof(r.value) <> 'object') then
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
      -- A page past the edition's (or her own) page count is cut back to the last page, as for a later edition change.
      v_prog_page := public.clamp_progress_page(
        v_prog_page, coalesce(v_pages, (select page_count from public.books where id = v_book_id)));

      insert into public.library_entries (member_id, book_id, import_key, page_count_override, added_at)
      values (
        v_member, v_book_id, v_key, v_pages,
        -- Midday UTC of the day it was added, so it is that day in every time zone near Europe and the Americas.
        coalesce(least((v_added + time '12:00') at time zone 'UTC', now()), now())
      )
      returning id into v_entry;

      if v_status = 'want_to_read' then
        if v_started is not null or v_ended is not null or v_rating is not null or v_review is not null
           or v_extra > 0 or jsonb_array_length(v_earlier) > 0 or v_row->>'outcome' is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
      elsif v_status = 'reading' then
        if v_started is null then
          raise exception 'date_invalid' using errcode = '22023';
        end if;
        if v_ended is not null or v_rating is not null or v_review is not null or v_row->>'outcome' is not null then
          raise exception 'session_invalid' using errcode = '22023';
        end if;
        -- Progress is set on the session itself: no reading_progress_days row, so an import never marks today as a reading day.
        insert into public.reading_sessions (entry_id, started_on, import_key, progress_page, progress_percent, progress_updated_at)
        values (v_entry, v_started, v_key, v_prog_page, v_prog_percent,
                case when num_nonnulls(v_prog_page, v_prog_percent) = 1 then now() end);
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
        -- An abandoned read keeps where she stopped (a closed session keeps its last value, as in the app).
        insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review, import_key,
                                             progress_page, progress_percent, progress_updated_at)
        values (v_entry, v_started, v_ended, v_outcome, v_rating, v_review, v_key,
                v_prog_page, v_prog_percent, case when num_nonnulls(v_prog_page, v_prog_percent) = 1 then now() end);
      end if;

      -- Her earlier reads, `<key>#2` …: first the ones with days (oldest
      -- first), then the undated ones, each finished and made a second apart
      -- before the row's own read, so it stays the latest (latest_session
      -- breaks ties on created_at).
      v_count := jsonb_array_length(v_earlier) + v_extra;
      v_n := 0;
      for v_read in select value from jsonb_array_elements(v_earlier) loop
        v_n := v_n + 1;
        v_read_start := (v_read->>'started_on')::date;
        v_read_end   := (v_read->>'ended_on')::date;
        if v_read_start is not null and v_read_end is not null and v_read_end < v_read_start then
          raise exception 'ended_before_started' using errcode = '22023';
        end if;
        insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, import_key, created_at)
        values (v_entry, v_read_start, v_read_end, 'finished', v_key || '#' || (v_n + 1),
                now() - make_interval(secs => v_count - v_n + 1));
      end loop;
      v_dated := v_n;
      for v_n in v_dated + 1 .. v_count loop
        insert into public.reading_sessions (entry_id, outcome, import_key, created_at)
        values (v_entry, 'finished', v_key || '#' || (v_n + 1), now() - make_interval(secs => v_count - v_n + 1));
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
$function$
;
