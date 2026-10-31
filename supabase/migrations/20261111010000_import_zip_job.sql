-- The Hardcover zip's extras reach the import job (docs/plans/hardcover-zip.md, PR 2): how far she was in a read, the order of
-- her ranked lists, and her empty lists. The device has read these off the zip already (data/import/hardcoverZip.ts) and, until
-- now, left them out of the upload. A CSV never carries any of them, so for a CSV import nothing here does anything.
--
--   import_books           takes an optional `progress` per row: { "page": n } or { "percent": n } (exactly one, whole numbers:
--                          a page 0 … 99999, a percent 0 … 100), only on a session that is open (Currently reading) or
--                          abandoned (Finished with outcome abandoned: a closed session keeps the place she stopped at, as in the
--                          app); anywhere else it is `session_invalid`, a value out of range or of another shape is
--                          `progress_invalid` (22023, the row only). It becomes what Libellus stores as a read's place: the
--                          session's `progress_page` or `progress_percent` and `progress_updated_at`, never both (audiobook
--                          seconds are turned into a percent on the device, the plan's rule). A page past the Book's page count
--                          (her own total when she has one) is cut back to it with `clamp_progress_page`, as a later edition
--                          change does. It writes NO `reading_progress_days` row: an import never marks today as a reading day.
--                          A row imported before or found in her Library adds nothing, as for every other field of a row.
--   start_import_job       takes two more optional arguments, kept with the job (`import_job_collections`):
--                            p_collection_order    [{ "name": text, "keys": [row key, …] }, …]   her ranked lists, in rank order
--                            p_empty_collections   [text, …]                                        her lists without a book
--                          Refused as `collections_invalid` (22023): not arrays of that shape, over 500 lists, a name that is no
--                          Collection name, over 10,000 keys a list, over 1 MB together. The old five-argument call is this one
--                          with both left out.
--   import_job_write       the job's FIRST write creates the empty Collections (the ones she does not have yet), as the member.
--   import_job_release     the job's end step: when the job is done, each ranked Collection is put in order, once, as the member,
--                          through `reorder_collection`: this import's entries (put on the Collection since the import began; a
--                          retry takes the time over, so it also ranks the books its failed predecessor wrote, found by their import
--                          key) are put in rank order after her older ones, which keep their places at the front. A key without an entry (a row that failed, a book the device did
--                          not upload) and a list she no longer has are passed over. A failure of the end step (even a
--                          statement timeout) is a warning in the log, never a failed job.
--   retry_import_job      carries the two lists over to the new job.
--
-- Security: every function stays SECURITY DEFINER with the checks it had. The job acts as its own member only (the claims
-- come from the job row, for the runner holding its lease: `import_job_as_member`), so a Collection or an entry is only ever
-- looked up among HER rows (`member_id` is in every query), and `reorder_collection` / `create_collection` run as her. The
-- table below is read by no member and no role but the definers (RLS on, no policy, no grant).
--
-- Safe for a job queued before this migration (the old row shape): it has no `import_job_collections` row, so the end step
-- and the first write find nothing to do; its rows carry no `progress`, which `import_books` reads as none.

-- ------------------------------------------------------------------ the lists of a job

create table public.import_job_collections (
  job_id            uuid primary key references public.import_jobs (id) on delete cascade,
  -- [{ name, keys: [row key, …] }, …]: her ranked lists, each with the keys of its rows in rank order.
  collection_order  jsonb not null default '[]' check (jsonb_typeof(collection_order) = 'array'),
  -- [name, …]: her lists without a book.
  empty_collections jsonb not null default '[]' check (jsonb_typeof(empty_collections) = 'array'),
  -- The empty Collections are made (by the job's first write).
  empty_made        boolean not null default false,
  -- When the import began: the end step ranks the entries put on a Collection from then on. A retried job keeps its failed
  -- predecessor's, so the books that one wrote are ranked too.
  began_at          timestamptz not null default now()
);

comment on table public.import_job_collections is
  'The lists of a Hardcover zip import (their order, and the empty ones), kept with the job until its end step has used them. '
  'No member reads it; deleted when the job is done, cancelled, or 30 days after it ends.';

alter table public.import_job_collections enable row level security;
revoke all on public.import_job_collections from public, anon, authenticated;

-- Whether a start's `p_collection_order` has the shape the job reads: at most 500 lists, each { name (a Collection name), keys (at
-- most 10,000 row keys of at most 300 characters) }, at most 1 MB together.
create function private.import_collection_order_valid(p_order jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_key jsonb;
begin
  if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) > 500 or pg_column_size(p_order) > 1000000 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_order) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'name') is distinct from 'string'
       or public.collection_name(v_item ->> 'name') is null
       or jsonb_typeof(v_item -> 'keys') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(v_item -> 'keys') > 10000 then return false; end if;
    for v_key in select value from jsonb_array_elements(v_item -> 'keys') loop
      if jsonb_typeof(v_key) <> 'string' or char_length(v_key #>> '{}') not between 1 and 300 then return false; end if;
    end loop;
  end loop;
  return true;
end
$$;

-- The same for `p_empty_collections`: at most 500 names (strings of at most 1,000 characters; one that is no Collection name is
-- passed over when the Collection is made, as `import_place_in_collections` does).
create function private.import_empty_collections_valid(p_names jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_name jsonb;
begin
  if jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 500 or pg_column_size(p_names) > 1000000 then
    return false;
  end if;
  for v_name in select value from jsonb_array_elements(p_names) loop
    if jsonb_typeof(v_name) <> 'string' or char_length(v_name #>> '{}') > 1000 then return false; end if;
  end loop;
  return true;
end
$$;

revoke all on function private.import_collection_order_valid(jsonb) from public, anon, authenticated;
revoke all on function private.import_empty_collections_valid(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------ import_books

-- `import_books` of 20261009100000_import_books_earlier_reads.sql, whole; the change: the optional `progress` of a row (above).
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
$$;

revoke all on function public.import_books(jsonb) from public, anon;
grant execute on function public.import_books(jsonb) to authenticated;

-- ------------------------------------------------------------------ start_import_job

-- `start_import_job` of 20261102010000_import_jobs.sql, whole; the change: the two optional lists (above). A new signature, so
-- the old one goes (a call with five arguments finds this one, the new two have defaults).
drop function public.start_import_job(jsonb, text, text, integer, text[]);

create function public.start_import_job(p_rows jsonb, p_source text, p_device text default null, p_already integer default 0,
                                        p_languages text[] default '{}', p_collection_order jsonb default null,
                                        p_empty_collections jsonb default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_job uuid;
  v_count integer;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 10000
     or pg_column_size(p_rows) > 5000000 then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  if p_source is null or p_source !~ '^[a-z]{1,20}$' then raise exception 'source_invalid' using errcode = '22023'; end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then
    raise exception 'device_invalid' using errcode = '22023';
  end if;
  if p_already is null or p_already not between 0 and 100000 then raise exception 'already_invalid' using errcode = '22023'; end if;
  if p_languages is null or cardinality(p_languages) > 5
     or exists (select 1 from unnest(p_languages) l where l is null or l !~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})?$') then
    raise exception 'languages_invalid' using errcode = '22023';
  end if;
  -- A Hardcover zip's lists (none for a CSV): her ranked lists in order, and her empty ones.
  if p_collection_order is not null and jsonb_typeof(p_collection_order) <> 'null'
     and not private.import_collection_order_valid(p_collection_order) then
    raise exception 'collections_invalid' using errcode = '22023';
  end if;
  if p_empty_collections is not null and jsonb_typeof(p_empty_collections) <> 'null'
     and not private.import_empty_collections_valid(p_empty_collections) then
    raise exception 'collections_invalid' using errcode = '22023';
  end if;
  -- Every row an object with a key of its own, at most 20 kB.
  select count(*) into v_count
    from jsonb_array_elements(p_rows) r
   where jsonb_typeof(r) <> 'object'
      or jsonb_typeof(r -> 'key') <> 'string'
      or char_length(r ->> 'key') not between 1 and 300
      or pg_column_size(r) > 20000;
  if v_count > 0 then raise exception 'rows_invalid' using errcode = '22023'; end if;
  if (select count(distinct r ->> 'key') from jsonb_array_elements(p_rows) r) <> jsonb_array_length(p_rows) then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  if exists (select 1 from public.import_jobs where member_id = v_member and state in ('queued', 'running', 'paused')) then
    raise exception 'import_running' using errcode = '55000';
  end if;
  -- Her device import still holds a place (the slot or a place in line): it has to leave first (import_slot_leave),
  -- so a job never takes over a place whose import is still writing on the device.
  if exists (select 1 from public.import_queue where member_id = v_member and holder not like 'job:%') then
    raise exception 'device_import_running' using errcode = '55000';
  end if;
  -- One start per member per 2 minutes (every start stores up to 5 MB and calls the function).
  if exists (select 1 from public.import_jobs where member_id = v_member and created_at > now() - interval '2 minutes') then
    raise exception 'import_too_soon' using errcode = '55000';
  end if;
  insert into public.import_jobs (member_id, device, source, languages, total, already)
  values (v_member, p_device, p_source, p_languages, jsonb_array_length(p_rows), p_already)
  returning id into v_job;
  insert into public.import_job_rows (job_id, idx, key, payload)
  select v_job, (r.ord - 1)::integer, r.value ->> 'key', r.value
    from jsonb_array_elements(p_rows) with ordinality as r (value, ord);
  if coalesce(jsonb_array_length(case when jsonb_typeof(p_collection_order) = 'array' then p_collection_order end), 0) > 0
     or coalesce(jsonb_array_length(case when jsonb_typeof(p_empty_collections) = 'array' then p_empty_collections end), 0) > 0 then
    insert into public.import_job_collections (job_id, collection_order, empty_collections)
    values (v_job,
            case when jsonb_typeof(p_collection_order) = 'array' then p_collection_order else '[]'::jsonb end,
            case when jsonb_typeof(p_empty_collections) = 'array' then p_empty_collections else '[]'::jsonb end);
  end if;
  perform private.import_job_enqueue(v_job);
  -- Member-triggered: held back by the debounce (the tick, every minute, is the safety net).
  perform private.import_job_kick(false);
  return v_job;
end
$$;

-- ------------------------------------------------------------------ retry_import_job

-- `retry_import_job` of 20261105010000_import_job_retry.sql, whole; the change: the failed job's lists go to the new job.
create or replace function public.retry_import_job(p_job uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_job public.import_jobs;
  v_rows jsonb;
  v_left integer;
  v_lists public.import_job_collections;
  v_new uuid;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  select * into v_job from public.import_jobs where id = p_job and member_id = v_member;
  if v_job.id is null then raise exception 'job_unknown' using errcode = 'P0002'; end if;
  if v_job.state <> 'failed' then raise exception 'job_not_failed' using errcode = '55000'; end if;
  select jsonb_agg(r.payload order by r.idx), count(*)::integer
    into v_rows, v_left
    from public.import_job_rows r
   where r.job_id = p_job and (r.outcome is null or r.outcome = 'failed');
  if v_rows is null then raise exception 'job_unknown' using errcode = 'P0002'; end if;
  select * into v_lists from public.import_job_collections where job_id = p_job;
  v_new := public.start_import_job(
    v_rows,
    v_job.source,
    v_job.device,
    least(100000, v_job.already + greatest(0, v_job.total - v_left)),
    v_job.languages,
    v_lists.collection_order,
    v_lists.empty_collections
  );
  -- The retried import began when the failed one did.
  if v_lists.job_id is not null then
    update public.import_job_collections set began_at = v_lists.began_at where job_id = v_new;
  end if;
  return v_new;
end
$$;

-- ------------------------------------------------------------------ import_job_write

-- `import_job_write` of 20261102010000_import_jobs.sql, whole; the change: the first write makes her empty Collections.
create or replace function public.import_job_write(p_job uuid, p_runner text, p_idx integer, p_row jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_job_rows;
  v_outcome jsonb;
  v_before text[];
begin
  v_before := private.import_job_as_member(p_job, p_runner);
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then raise exception 'row_unknown' using errcode = 'P0002'; end if;
  if v_row.outcome is not null then
    perform private.import_job_as_caller(v_before);
    return jsonb_build_object('key', v_row.key, 'outcome', v_row.outcome, 'entry_id', v_row.entry_id, 'error', v_row.error);
  end if;
  -- The row's key is the file's: a payload naming another row's key writes nothing of it.
  if p_row is null or jsonb_typeof(p_row) <> 'object' or p_row ->> 'key' is distinct from v_row.key then
    raise exception 'row_invalid' using errcode = '22023';
  end if;
  -- The job's first write makes her empty Collections (once; the ones she has already stay as they are).
  perform private.import_job_make_empty_collections(p_job);
  select value into v_outcome from jsonb_array_elements(public.import_books(jsonb_build_array(p_row))) limit 1;
  update public.import_job_rows
     set outcome = v_outcome ->> 'outcome',
         entry_id = nullif(v_outcome ->> 'entry_id', '')::uuid,
         error = left(v_outcome ->> 'error', 200)
   where job_id = p_job and idx = p_idx;
  perform private.import_job_as_caller(v_before);
  return v_outcome;
end
$$;

-- ------------------------------------------------------------------ the lists, as the member

-- Her empty Collections, made once as the member (the caller has set her claims: `import_job_as_member`). A Collection she has
-- already (any case) is left as it is. Never fails its caller: a problem is a warning, and the lists count as made.
create function private.import_job_make_empty_collections(p_job uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_lists public.import_job_collections;
  v_member uuid;
  v_value jsonb;
  v_name text;
begin
  select * into v_lists from public.import_job_collections where job_id = p_job and not empty_made for update;
  if v_lists.job_id is null then return; end if;
  select member_id into v_member from public.import_jobs where id = p_job;
  begin
    for v_value in select value from jsonb_array_elements(v_lists.empty_collections) loop
      v_name := public.collection_name(v_value #>> '{}');
      continue when v_name is null;
      if not exists (select 1 from public.collections where member_id = v_member and lower(name) = lower(v_name)) then
        perform public.create_collection(v_name);
      end if;
    end loop;
  exception when others or query_canceled then
    raise warning 'import_job_make_empty_collections %: %', p_job, sqlerrm;
  end;
  update public.import_job_collections set empty_made = true where job_id = p_job;
end
$$;

-- The job's end step, as the member, for the runner holding the job: her empty Collections (when no write made them), then each
-- ranked Collection in order, through `reorder_collection`; then the lists are deleted (nothing is read of them again).
--   - this import's entries follow in rank order: the entry of each key (the job's own row, else her entry of that import key:
--     a retried job finds the books its failed predecessor wrote), when it is on the Collection and was put there since the
--     import began (`began_at`, which a retry takes over from the job it retries);
--   - every other entry on the Collection (hers from before) keeps its place at the front, in its order.
-- A list she no longer has, a key without an entry: passed over. A failure (including a statement timeout) is a warning, not a
-- failed job.
create function private.import_job_finish(p_job uuid, p_runner text)
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_lists public.import_job_collections;
  v_job public.import_jobs;
  v_before text[];
  v_item jsonb;
  v_name text;
  v_collection uuid;
  v_new uuid[];
  v_old uuid[];
begin
  select * into v_lists from public.import_job_collections where job_id = p_job for update;
  if v_lists.job_id is null then return; end if;
  select * into v_job from public.import_jobs where id = p_job;
  begin
    v_before := private.import_job_as_member(p_job, p_runner);
    perform private.import_job_make_empty_collections(p_job);
    for v_item in select value from jsonb_array_elements(v_lists.collection_order) loop
      begin
        v_name := public.collection_name(v_item ->> 'name');
        continue when v_name is null;
        select id into v_collection from public.collections where member_id = v_job.member_id and lower(name) = lower(v_name);
        continue when v_collection is null;
        select coalesce(array_agg(x.entry_id order by x.ord), '{}') into v_new
          from (
            select s.entry_id, min(s.ord) as ord
              from (
                select coalesce(r.entry_id, le.id) as entry_id, k.ord
                  from jsonb_array_elements_text(v_item -> 'keys') with ordinality as k (key, ord)
                  left join public.import_job_rows r on r.job_id = p_job and r.key = k.key and r.outcome is distinct from 'failed'
                  left join public.library_entries le on le.member_id = v_job.member_id and le.import_key = k.key
              ) s
              join public.collection_entries ce on ce.collection_id = v_collection and ce.entry_id = s.entry_id
             where ce.added_at >= v_lists.began_at
             group by s.entry_id
          ) x;
        select coalesce(array_agg(ce.entry_id order by ce.position), '{}') into v_old
          from public.collection_entries ce
         where ce.collection_id = v_collection and not (ce.entry_id = any (v_new));
        perform public.reorder_collection(v_collection, v_old || v_new);
      exception when others or query_canceled then
        raise warning 'import_job_finish %: a list was not put in order: %', p_job, sqlerrm;
      end;
    end loop;
  exception when others or query_canceled then
    raise warning 'import_job_finish %: %', p_job, sqlerrm;
  end;
  -- `import_job_as_member` raises before it sets anything, so no claims to give back when it failed.
  if v_before is not null then perform private.import_job_as_caller(v_before); end if;
  delete from public.import_job_collections where job_id = p_job;
end
$$;

revoke all on function private.import_job_make_empty_collections(uuid) from public, anon, authenticated;
revoke all on function private.import_job_finish(uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ the end step

-- `import_job_release` of 20261104010000_import_job_write.sql, whole; the change: when the job is done, its end step first.
create or replace function public.import_job_release(p_job uuid, p_runner text, p_error text default null, p_wait_until timestamptz default null)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.import_jobs;
  v_until timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  select * into v_job from public.import_jobs where id = p_job for update;
  if v_job.id is null or v_job.state <> 'running' or v_job.runner is distinct from p_runner then return 'gone'; end if;
  -- Rows handed out but not reached: the runner stopped in time, which is no fault of theirs (only a runner that dies
  -- leaves a row's attempt counted).
  update public.import_job_rows set taken_by = null, attempts = greatest(attempts - 1, 0)
   where job_id = p_job and state = 'pending' and taken_by = p_runner;
  update public.import_job_rows set cover_taken_by = null, cover_attempts = greatest(cover_attempts - 1, 0)
   where job_id = p_job and cover_state <> 'done' and cover_taken_by = p_runner;
  update public.import_job_rows set write_taken_by = null, write_attempts = greatest(write_attempts - 1, 0)
   where job_id = p_job and write_state = 'pending' and write_taken_by = p_runner;
  if not exists (select 1 from public.import_job_rows where job_id = p_job and (cover_state <> 'done' or write_state <> 'done')) then
    -- The end step: her ranked Collections in order (and her empty ones, when no write made them).
    perform private.import_job_finish(p_job, p_runner);
    update public.import_jobs set state = 'done', finished_at = now(), runner = null, lease_until = null, error = null
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'done';
  end if;
  if p_error is not null then
    update public.import_jobs
       set state = 'paused', runner = null, lease_until = null, error = left(p_error, 500),
           not_before = now() + least(interval '1 minute' * power(2, least(v_job.stalls, 4)), interval '15 minutes')
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'paused';
  end if;
  -- Waiting is not a fault: the stage was told to wait, or every row left is waiting for its retry.
  v_until := p_wait_until;
  if v_until is null and not exists (select 1 from public.import_job_rows where job_id = p_job and state = 'pending')
     and not exists (select 1 from public.import_job_rows
                      where job_id = p_job and cover_state <> 'done' and (cover_not_before is null or cover_not_before <= now())) then
    select min(cover_not_before) into v_until from public.import_job_rows where job_id = p_job and cover_state <> 'done';
  end if;
  if v_until is not null and v_until > now() then
    update public.import_jobs
       set state = 'paused', runner = null, lease_until = null, error = null,
           not_before = least(v_until, now() + interval '1 hour'), progress_at = clock_timestamp()
     where id = p_job;
    perform private.import_job_dequeue(p_job);
    perform private.import_job_kick(true);
    return 'paused';
  end if;
  update public.import_jobs set runner = null, lease_until = null where id = p_job;
  perform private.import_job_kick(true);
  return 'more';
end
$$;

-- ------------------------------------------------------------------ cleanup

-- `cancel_import_job` and `private.import_job_tick` of 20261102010000_import_jobs.sql, whole; the change: the job's lists go with
-- its rows (when she cancels, and 30 days after a job ended).
create or replace function public.cancel_import_job(p_job uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  update public.import_jobs
     set state = 'cancelled', finished_at = now(), runner = null, lease_until = null
   where id = p_job and member_id = v_member and state in ('queued', 'running', 'paused');
  if not found then return false; end if;
  perform private.import_job_dequeue(p_job);
  -- Her rows name her books: nothing is left to look up, so they go with the cancel.
  delete from public.import_job_rows where job_id = p_job;
  delete from public.import_job_collections where job_id = p_job;
  perform private.import_job_kick(false);
  return true;
end
$$;

create or replace function private.import_job_tick()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job uuid;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  for v_job in
    update public.import_jobs
       set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null
     where state = 'running' and progress_at < now() - interval '30 minutes'
    returning id
  loop
    perform private.import_job_dequeue(v_job);
  end loop;
  update public.import_jobs set state = 'queued', not_before = null
   where state = 'paused' and not_before <= now();
  for v_job in
    select j.id from public.import_jobs j
     where j.state in ('queued', 'running')
       and not exists (select 1 from public.import_queue q where q.holder = 'job:' || j.id::text)
     order by j.created_at
  loop
    perform private.import_job_enqueue(v_job);
  end loop;
  perform private.import_slot_sweep();
  delete from public.import_job_rows r
   using public.import_jobs j
   where r.job_id = j.id and j.finished_at < now() - interval '30 days';
  delete from public.import_job_collections c
   using public.import_jobs j
   where c.job_id = j.id and j.finished_at < now() - interval '30 days';
  return private.import_job_kick(false);
end
$$;

-- ------------------------------------------------------------------ grants

revoke all on function public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb) from public, anon;
grant execute on function public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb) to authenticated;
revoke all on function public.retry_import_job(uuid) from public, anon;
grant execute on function public.retry_import_job(uuid) to authenticated;
revoke all on function public.import_job_write(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.import_job_write(uuid, text, integer, jsonb) to service_role;
revoke all on function public.import_job_release(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_job_release(uuid, text, text, timestamptz) to service_role;
revoke all on function public.cancel_import_job(uuid) from public, anon;
grant execute on function public.cancel_import_job(uuid) to authenticated;
revoke all on function private.import_job_tick() from public, anon, authenticated;
