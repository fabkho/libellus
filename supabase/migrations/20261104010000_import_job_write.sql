-- The import job's write phase (proposal #329, part 4; owner decision 2026-10-19: no review step): once every row is matched
-- and has its cover decision, the job writes EVERY row to the member's Library, exactly as the app's import writes it
-- (`import_books`, run as the member by `import_job_write`: statuses, dates, ratings, shelves), and hands the covers it
-- found for Catalogue Books to `fill_book_covers` (`import_job_fill_covers`: only a Book the member holds, only one without
-- a cover, an allow-listed address: a member's own cover choice, another edition's cover and a cover another member's
-- upgrade put there are never overwritten; the job never sends `replaces`, that is the device's one-time Apple upgrade).
--
-- A row's write is its own state, after its cover decision:
--
--   write_state  'pending'  not written yet (a row still to match or to cover is 'pending' too)
--                'done'     written: `outcome` says what it came to (added / imported / in_library / failed + `error`)
--
-- so a row is finished when `write_state = 'done'` and the JOB IS DONE when every row has its outcome. The counters
-- `added`, `kept` (imported + in_library: already in her Library) and `failed` count the rows by outcome, each row exactly
-- once: whoever sets a row's write state to 'done' counts its outcome (the write phase's save, a row given up, a result
-- that came with an outcome). `added + kept + failed` is the rows written.
--
-- What the write needs of the match is saved with it (`match_book`): the Book the row is written with (a snapshot as the
-- source gave it, or the Catalogue Book's id), the sibling edition's cover it borrows and whether the cover fill found
-- its cover. The cover stage's decision (`cover_url`) is the cover the Book is written with.
--
-- Resumable and idempotent per row, like the other phases:
--   - `import_job_take_write_rows` hands rows out (never before every row is matched and covered), a row handed out
--     three times without being saved killed its runners: it is given up (failed `gave_up`, unless its write was
--     recorded: that outcome stands); after a crash the suspects come one at a time;
--   - `import_job_write` (part 1) records the outcome with the write in one transaction and answers the recorded outcome
--     to a second call: a row is never written twice, whatever happens to the runner after;
--   - `import_job_save_write` marks the row written (and records a failure for a row `import_books` could not even be
--     asked about).

-- ------------------------------------------------------------------ columns

alter table public.import_job_rows
  add column write_state text not null default 'pending' check (write_state in ('pending', 'done')),
  -- What the match chose to write: { book, lent, filled } (the Book, the sibling edition's cover, the fill found its cover).
  add column match_book jsonb check (match_book is null or jsonb_typeof(match_book) = 'object'),
  -- Handed to a runner (and how often without a save: the crash guard of the write phase).
  add column write_taken_by text,
  add column write_attempts smallint not null default 0;

-- Rows with an outcome before the phase existed (nothing is deployed for members yet) are written.
update public.import_job_rows set write_state = 'done' where outcome is not null;

create index import_job_rows_write on public.import_job_rows (job_id, idx) where write_state = 'pending';

comment on column public.import_job_rows.write_state is
  'pending: not written yet; done: written (outcome says what it came to).';
comment on column public.import_job_rows.match_book is
  'What the match chose to write: the Book (a snapshot, or the Catalogue Book''s id), the sibling edition''s cover it borrows, and whether the cover fill found its cover.';

-- --------------------------------------------------------------- the match's save

-- `import_job_save_row` of 20261103010000_import_job_covers.sql, whole; the changes: `p_result.write` is kept (`match_book`),
-- and a row is written (its outcome counted) only when its result says what it came to or a write was recorded before;
-- the match saves no outcome (the write phase does).
create or replace function public.import_job_save_row(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
returns boolean
language plpgsql
volatile
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
  v_source := case v_cover when 'own' then 'edition' when 'lent' then 'lent' when 'goodreads' then 'goodreads'
                           when 'none' then null else 'none' end;
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
         cover_url = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_url') ~ '^https://[^[:space:]]+$'
                          then p_result ->> 'cover_url' end,
         cover_size = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_size') in ('S', 'M', 'L')
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

-- --------------------------------------------------------------- the match's take

-- `import_job_take_rows` of 20261103010000_import_job_covers.sql, whole; the change: a row given up in the match is
-- written too (failed, `gave_up`), so the job can finish.
create or replace function public.import_job_take_rows(p_job uuid, p_runner text, p_limit integer default 8)
returns table (idx integer, key text, payload jsonb, pass smallint, attempts smallint)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_gave_up integer;
  v_added integer;
  v_kept integer;
  v_failed integer;
  v_suspects boolean;
begin
  if not private.import_job_held(p_job, p_runner) then return; end if;
  with gone as (
    update public.import_job_rows r
       set state = 'done', outcome = coalesce(r.outcome, 'failed'), error = coalesce(r.error, 'gave_up'), tier = 'needsLook',
           taken_by = null, done_at = now(), cover_state = 'done', cover_source = 'none', write_state = 'done'
     where r.job_id = p_job and r.state = 'pending' and r.attempts >= 3 and r.taken_by is distinct from p_runner
    returning r.outcome
  )
  select count(*), count(*) filter (where outcome = 'added'), count(*) filter (where outcome in ('imported', 'in_library')),
         count(*) filter (where outcome = 'failed')
    into v_gave_up, v_added, v_kept, v_failed from gone;
  if v_gave_up > 0 then
    -- A row whose write was recorded counts as what it came to, not as failed.
    update public.import_jobs
       set done = done + v_gave_up, added = added + v_added, kept = kept + v_kept, failed = failed + v_failed,
           needs_look = needs_look + v_gave_up, cover_none = cover_none + v_gave_up, progress_at = clock_timestamp()
     where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_suspects := exists (select 1 from public.import_job_rows r
                         where r.job_id = p_job and r.state = 'pending' and r.taken_by is distinct from p_runner and r.attempts >= 2);
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.state = 'pending' and r.taken_by is distinct from p_runner
       order by (v_suspects and r.attempts >= 2) desc, r.pass, r.idx
       limit case when v_suspects then 1 else greatest(1, least(coalesce(p_limit, 8), 50)) end
       for update
    )
    update public.import_job_rows r
       set taken_by = p_runner, attempts = r.attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.pass, r.attempts;
end
$$;

-- --------------------------------------------------------------- the write phase

-- The next rows to write. Nothing until every row is matched and has its cover decision (the phase is its own, after the
-- cover stage). A row handed out three times without being saved killed its runners: it is given up (failed
-- `gave_up`; a write that was recorded stands). After a crash the suspects (handed out twice already) come one at a time.
create function public.import_job_take_write_rows(p_job uuid, p_runner text, p_limit integer default 8)
returns table (idx integer, key text, payload jsonb, match_book jsonb, cover_source text, cover_url text, cover_size text, outcome text)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_gave_up integer;
  v_added integer;
  v_kept integer;
  v_failed integer;
  v_suspects boolean;
begin
  if not private.import_job_held(p_job, p_runner) then return; end if;
  if exists (select 1 from public.import_job_rows r where r.job_id = p_job and (r.state = 'pending' or r.cover_state <> 'done')) then
    return;
  end if;
  with gone as (
    update public.import_job_rows r
       set write_state = 'done', outcome = coalesce(r.outcome, 'failed'), write_taken_by = null,
           error = case when r.outcome is null then coalesce(r.error, 'gave_up') else r.error end
     where r.job_id = p_job and r.write_state = 'pending' and r.write_attempts >= 3 and r.write_taken_by is distinct from p_runner
    returning r.outcome as written
  )
  select count(*), count(*) filter (where written = 'added'), count(*) filter (where written in ('imported', 'in_library')),
         count(*) filter (where written = 'failed')
    into v_gave_up, v_added, v_kept, v_failed from gone;
  if v_gave_up > 0 then
    update public.import_jobs
       set added = added + v_added, kept = kept + v_kept, failed = failed + v_failed, progress_at = clock_timestamp()
     where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_suspects := exists (select 1 from public.import_job_rows r
                         where r.job_id = p_job and r.write_state = 'pending' and r.write_taken_by is distinct from p_runner
                           and r.write_attempts >= 2);
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.write_state = 'pending' and r.write_taken_by is distinct from p_runner
       order by (v_suspects and r.write_attempts >= 2) desc, r.idx
       limit case when v_suspects then 1 else greatest(1, least(coalesce(p_limit, 8), 50)) end
       for update
    )
    update public.import_job_rows r
       set write_taken_by = p_runner, write_attempts = r.write_attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.match_book, r.cover_source, r.cover_url, r.cover_size, r.outcome;
end
$$;

-- One row written. The outcome is the one `import_job_write` recorded; `p_result` ({ outcome, error }) records one for a
-- row `import_books` could not be asked about (a refused row: failed, with the reason). A second save is a no-op.
-- Answers whether the runner goes on (false: cancelled, or the job is another runner's now).
create function public.import_job_save_write(p_job uuid, p_runner text, p_idx integer, p_result jsonb default null)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_job_rows;
  v_outcome text;
  v_done integer;
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  if v_row.write_state = 'done' then return true; end if;
  if v_row.outcome is null then
    v_outcome := p_result ->> 'outcome';
    if v_outcome is null or v_outcome not in ('added', 'imported', 'in_library', 'failed') then
      raise exception 'write_missing' using errcode = '22023';
    end if;
    update public.import_job_rows
       set outcome = v_outcome, entry_id = nullif(p_result ->> 'entry_id', '')::uuid, error = left(p_result ->> 'error', 200)
     where job_id = p_job and idx = p_idx;
  else
    v_outcome := v_row.outcome;
  end if;
  update public.import_job_rows set write_state = 'done', write_taken_by = null where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set added = added + (v_outcome = 'added')::integer,
         kept = kept + (v_outcome in ('imported', 'in_library'))::integer,
         failed = failed + (v_outcome = 'failed')::integer,
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning done, member_id into v_done, v_member;
  update public.import_queue set beat_at = clock_timestamp() where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$$;

-- --------------------------------------------------------------- the release

-- `import_job_release` of 20261103010000_import_job_covers.sql, whole; the change: the job is done when every row is
-- matched, has its cover decision AND its outcome (written), and a row handed out but not reached in the write phase
-- is given back like the others. A done, failed or cancelled job gives the queue's place up (`import_job_dequeue`).
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

-- ------------------------------------------------------------------ grants

revoke all on function public.import_job_take_write_rows(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.import_job_save_write(uuid, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.import_job_take_write_rows(uuid, text, integer) to service_role;
grant execute on function public.import_job_save_write(uuid, text, integer, jsonb) to service_role;
