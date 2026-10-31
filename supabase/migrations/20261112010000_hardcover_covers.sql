-- Hardcover's covers (docs/plans/hardcover-zip.md, "Covers from Hardcover", PR 3): the images of a Hardcover "everything"
-- zip (`cached_image` of a book or edition, always on `assets.hardcover.app`) become a cover source, `hardcover`.
--
-- 1. `private.cover_allowed` gains the host: the Catalogue refuses a cover off this list (`books_cover_url_allowed`,
--    `import_book_for`, `fill_book_covers`, `cover_store_reconcile`), so the import's Hardcover cover can be written
--    and stored. Same rule as before: https, the whole host exactly (no subdomain), then `/` or nothing.
-- 2. `private.cover_shown` is NOT the same list any more: owner decision (31 Oct 2026), Hardcover's covers stay off every
--    surface that is not the member's own app. `cover_shown` is false for `assets.hardcover.app`, so the Book JSON of every
--    answer that hands a Book to somebody else (a reading page, `/r/` and its link preview, the feed, a member's profile,
--    the readers of a Book) carries neither the address nor the stored copy's key (`cover_key`, `cover_widths`: they travel
--    exactly where the URL travels, 20261109010000); the page draws the generated cover instead. Inside the app, on her own
--    Library and on the Catalogue's cards, the cover shows. Off switch for the whole source: drop the host from
--    `cover_allowed` again (the stored address stays in `books.cover_url`, hidden on the social surfaces anyway).
-- 3. The import job decides the cover when it saves the match (`import_job_save_row`): a new source `hardcover` (cover
--    `hardcover` of the row's result), its own counter `import_jobs.cover_hardcover`. The cover stage never decides it, so
--    `import_job_save_cover` is as it was.
--
-- Nothing else reads the address from a row: `cover_source = 'hardcover'` goes through `import_job_take_write_rows` like any
-- other, and the write gives the Book the address (`import_books`, `fill_book_covers`) only because step 1 allows it.

-- ------------------------------------------------------------------------------------------ 1. the allow-list

create or replace function private.cover_allowed(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|i\.gr-assets\.com|assets\.hardcover\.app|([a-z0-9-]+\.)+mzstatic\.com)(/|$)',
    false)
$$;

-- ------------------------------------------------------------------------------------ 2. what others may see

-- `cover_allowed`, minus the hosts that are the member's own app only (Hardcover's). Same grants as before (`create or replace`
-- keeps them; revoked from every API role since 20261022010000).
create or replace function private.cover_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select private.cover_allowed(p_book.cover_url)
     and p_book.cover_url !~* '^https://assets\.hardcover\.app(/|$)'
$$;

-- ------------------------------------------------------------------------------------------ 3. the job

alter table public.import_jobs
  add column cover_hardcover integer not null default 0;

alter table public.import_job_rows drop constraint import_job_rows_cover_check;
alter table public.import_job_rows add constraint import_job_rows_cover_check
  check (cover = any (array['own'::text, 'lent'::text, 'hardcover'::text, 'goodreads'::text, 'none'::text]));

alter table public.import_job_rows drop constraint import_job_rows_cover_source_check;
alter table public.import_job_rows add constraint import_job_rows_cover_source_check
  check (cover_source = any (array['edition'::text, 'lent'::text, 'hardcover'::text, 'openlibrary'::text, 'goodreads'::text, 'none'::text]));

-- `import_job_save_row` of 20261111010000_import_zip_job.sql, whole; the change: `hardcover` is a cover decided with the
-- match (kept with its address, like `lent` and `goodreads`) and has its counter.
create or replace function public.import_job_save_row(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_job_rows;
  v_outcome text := p_result ->> 'outcome';
  v_tier text := p_result ->> 'tier';
  v_cover text := p_result ->> 'cover';
  v_source text;
  v_state text;
  v_written text;
  v_done integer;
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  if v_row.state = 'done' then return true; end if;
  if coalesce((p_result ->> 'defer')::boolean, false) and v_row.pass = 0 then
    update public.import_job_rows set pass = 1, taken_by = null, attempts = 0 where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  v_state := case when v_cover = 'none' then 'pending' else 'done' end;
  v_source := case v_cover when 'own' then 'edition' when 'lent' then 'lent' when 'hardcover' then 'hardcover'
                           when 'goodreads' then 'goodreads' when 'none' then null else 'none' end;
  v_outcome := coalesce(v_row.outcome, v_outcome);
  update public.import_job_rows
     set state = 'done', taken_by = null, done_at = now(),
         verdict = p_result ->> 'verdict',
         tier = v_tier,
         -- A write recorded already (import_job_write) stands.
         outcome = v_outcome,
         entry_id = coalesce(v_row.entry_id, nullif(p_result ->> 'entry_id', '')::uuid),
         error = left(coalesce(v_row.error, p_result ->> 'error'), 200),
         edition = p_result -> 'edition',
         match_book = p_result -> 'write',
         write_state = case when v_outcome is not null then 'done' else 'pending' end,
         cover = v_cover,
         cover_state = v_state,
         cover_source = v_source,
         cover_url = case when v_source in ('edition', 'lent', 'hardcover', 'goodreads') and (p_result ->> 'cover_url') ~ '^https://[^[:space:]]+$'
                          then p_result ->> 'cover_url' end,
         cover_size = case when v_source in ('edition', 'lent', 'hardcover', 'goodreads') and (p_result ->> 'cover_size') in ('S', 'M', 'L')
                           then p_result ->> 'cover_size' end
   where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set done = done + 1,
         -- A result without an outcome or a tier counts as neither (a NULL would void the count).
         added = added + coalesce((v_outcome = 'added')::integer, 0),
         kept = kept + coalesce((v_outcome in ('imported', 'in_library'))::integer, 0),
         failed = failed + coalesce((v_outcome = 'failed')::integer, 0),
         needs_look = needs_look + coalesce((v_tier = 'needsLook')::integer, 0),
         cover_edition = cover_edition + coalesce((v_source = 'edition')::integer, 0),
         cover_lent = cover_lent + coalesce((v_source = 'lent')::integer, 0),
         cover_hardcover = cover_hardcover + coalesce((v_source = 'hardcover')::integer, 0),
         cover_goodreads = cover_goodreads + coalesce((v_source = 'goodreads')::integer, 0),
         cover_none = cover_none + coalesce((v_source = 'none')::integer, 0),
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning done, member_id into v_done, v_member;
  -- The queue's beat: the others in line see how far it is.
  update public.import_queue set beat_at = clock_timestamp(), done = least(v_done, rows)
   where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$$;
