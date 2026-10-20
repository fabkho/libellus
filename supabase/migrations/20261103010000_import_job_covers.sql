-- The import job's cover stage (proposal #329, part 3; owner rules 2026-10-19): after a row is matched, the job decides
-- its cover with the sources the app uses today, WITHOUT Apple (Apple runs later, on the device, as the one-time upgrade):
--
--   1. the edition's own cover ('edition'), else a cover lent by another edition of its work ('lent'): both are known
--      from the match (the app's own `coverLender` / `mergeCover` rules), so such a row's cover is decided when its match
--      is saved;
--   2. else Open Library: the cover of the row's ISBN, else of another edition of its work ('openlibrary');
--   3. else Goodreads, for EVERY row still without a cover when step 2 is through for all rows ('goodreads'): no time
--      budget and no "three failures and stop" for the job; an empty or unsure answer is asked again later in the job
--      (three tries, at least 30 s apart), a block pauses the stage for the job (the job waits, then goes on).
--
-- A row's cover decision is its own state, after its match:
--
--   cover_state  'pending'   the row has no cover yet (a row still to match is 'pending' too): Open Library next
--                'goodreads' Open Library had none: Goodreads next (only when no row is 'pending' any more)
--                'done'      decided: `cover_source` says by whom (edition / lent / openlibrary / goodreads / none)
--
-- so "a row is finished" is `cover_state = 'done'`, and a job is done when every row has its cover decision. The cover
-- is stored as an address (`cover_url`, `cover_size` when the address says it: S / M / L), never the image; no image
-- is read on the server (the decode and the thumbhash cost CPU the Free plan's 2 s does not have: the Library takes
-- them later). The job counts rows by source (`cover_edition`, `cover_lent`, `cover_openlibrary`, `cover_goodreads`,
-- `cover_none`).
--
-- Resumable and idempotent per row, like the match: `import_job_take_cover_rows` hands rows out (never before every
-- row is matched; Open Library's step for all rows before Goodreads'), `import_job_save_cover` decides one (a second
-- save is ignored), a row handed out three times without being saved is given up ('none'). A chunk with nothing due
-- (rows waiting for their retry) or told to wait (Goodreads blocked) PAUSES the job until then without a fault
-- (`import_job_release`, new `p_wait_until`): it gives the slot up and the tick queues it again.

-- ------------------------------------------------------------------ columns

alter table public.import_job_rows
  add column cover_state text not null default 'pending' check (cover_state in ('pending', 'goodreads', 'done')),
  add column cover_source text check (cover_source in ('edition', 'lent', 'openlibrary', 'goodreads', 'none')),
  add column cover_url text check (cover_url is null or cover_url ~ '^https://[^[:space:]]+$'),
  add column cover_size text check (cover_size in ('S', 'M', 'L')),
  -- Asks that came back unsure / unanswered (Goodreads), or failed (Open Library), and not before when it is asked again.
  add column cover_tries smallint not null default 0,
  add column cover_not_before timestamptz,
  -- Handed to a runner (and how often without a save: the crash guard of the cover stage).
  add column cover_taken_by text,
  add column cover_attempts smallint not null default 0;

-- Rows saved before the stage existed (nothing is deployed for members yet): their cover is what the match said.
update public.import_job_rows
   set cover_state = 'done',
       cover_source = case cover when 'own' then 'edition' when 'lent' then 'lent' when 'goodreads' then 'goodreads' else 'none' end
 where state = 'done';

alter table public.import_job_rows
  add constraint import_job_rows_cover_decided check (cover_state <> 'done' or cover_source is not null);

create index import_job_rows_cover on public.import_job_rows (job_id, cover_state, idx) where cover_state <> 'done';

comment on column public.import_job_rows.cover_state is
  'pending: no cover yet (Open Library next; a row still to match too); goodreads: Goodreads next; done: decided (cover_source).';

alter table public.import_jobs
  add column cover_edition integer not null default 0,
  add column cover_lent integer not null default 0,
  add column cover_openlibrary integer not null default 0,
  add column cover_goodreads integer not null default 0,
  add column cover_none integer not null default 0;

comment on column public.import_jobs.cover_none is
  'Rows by the source of their cover decision: edition, lent (a sibling edition''s), openlibrary, goodreads, none. '
  'Their sum is the rows whose cover is decided; the job is done when it is `done`.';

-- --------------------------------------------------------------- the match's save

-- `import_job_save_row` of 20261102010000_import_jobs.sql, whole; the change: the cover the match found. `p_result.cover`
-- 'own' / 'lent' / 'goodreads' is the row's cover decision (edition / lent / goodreads, with `cover_url` and `cover_size`);
-- 'none' sends the row on to the cover stage; a result without `cover` (a row the match has no cover to say about:
-- one already in the Library) is decided 'none'.
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
  update public.import_job_rows
     set state = 'done', taken_by = null, done_at = now(),
         verdict = p_result ->> 'verdict',
         tier = v_tier,
         -- A write recorded already (import_job_write) stands.
         outcome = coalesce(v_row.outcome, v_outcome),
         entry_id = coalesce(v_row.entry_id, nullif(p_result ->> 'entry_id', '')::uuid),
         error = left(coalesce(v_row.error, p_result ->> 'error'), 200),
         edition = p_result -> 'edition',
         cover = v_cover,
         cover_state = v_state,
         cover_source = v_source,
         cover_url = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_url') ~ '^https://[^[:space:]]+$'
                          then p_result ->> 'cover_url' end,
         cover_size = case when v_source in ('edition', 'lent', 'goodreads') and (p_result ->> 'cover_size') in ('S', 'M', 'L')
                           then p_result ->> 'cover_size' end
   where job_id = p_job and idx = p_idx
  returning outcome into v_outcome;
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

-- `import_job_take_rows` of 20261102010000_import_jobs.sql, whole; the change: a row given up in the match has its cover
-- decided too ('none'), so the job can finish.
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
           taken_by = null, done_at = now(), cover_state = 'done', cover_source = 'none'
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

-- --------------------------------------------------------------- the cover stage

-- The next rows to decide a cover for. Nothing until every row is matched (the stage is its own phase, after the match).
-- Open Library's step ('pending') for every row before Goodreads' ('goodreads': "at the end of the job"). Rows not due
-- yet (`cover_not_before`: a retry waits) are not handed out; a row handed out three times without being saved killed
-- its runners: it is given up ('none').
create function public.import_job_take_cover_rows(p_job uuid, p_runner text, p_limit integer default 8)
returns table (idx integer, key text, payload jsonb, edition jsonb, cover_state text, cover_tries smallint)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_gave_up integer;
  v_step text;
begin
  if not private.import_job_held(p_job, p_runner) then return; end if;
  if exists (select 1 from public.import_job_rows r where r.job_id = p_job and r.state = 'pending') then return; end if;
  with gone as (
    update public.import_job_rows r
       set cover_state = 'done', cover_source = 'none', cover_url = null, cover_size = null, cover_taken_by = null
     where r.job_id = p_job and r.cover_state <> 'done' and r.cover_attempts >= 3 and r.cover_taken_by is distinct from p_runner
    returning 1
  )
  select count(*) into v_gave_up from gone;
  if v_gave_up > 0 then
    update public.import_jobs set cover_none = cover_none + v_gave_up, progress_at = clock_timestamp() where id = p_job;
  end if;
  update public.import_jobs set lease_until = greatest(lease_until, now() + interval '170 seconds') where id = p_job;
  v_step := case when exists (select 1 from public.import_job_rows r where r.job_id = p_job and r.cover_state = 'pending')
                 then 'pending' else 'goodreads' end;
  return query
    with next as (
      select r.job_id, r.idx
        from public.import_job_rows r
       where r.job_id = p_job and r.cover_state = v_step and r.cover_taken_by is distinct from p_runner
         and (r.cover_not_before is null or r.cover_not_before <= now())
       order by r.idx
       limit greatest(1, least(coalesce(p_limit, 8), 50))
       for update
    )
    update public.import_job_rows r
       set cover_taken_by = p_runner, cover_attempts = r.cover_attempts + 1
      from next
     where r.job_id = next.job_id and r.idx = next.idx
    returning r.idx, r.key, r.payload, r.edition, r.cover_state, r.cover_tries;
end
$$;

-- One row's cover step done. `p_result`:
--   { source: 'openlibrary' | 'goodreads', url, size? }  decided: the cover found
--   { source: 'none' }                                    decided: no cover
--   { next: 'goodreads' }                                 Open Library had none: Goodreads is next
--   { retry: true, wait_seconds }                         not answered (unsure, failed): one try more, asked again
--                                                         no sooner than `wait_seconds` (at most an hour)
-- Answers whether the runner goes on (false: cancelled, or the job is another runner's now).
create function public.import_job_save_cover(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row public.import_job_rows;
  v_source text := p_result ->> 'source';
  v_url text := p_result ->> 'url';
  v_member uuid;
begin
  if not private.import_job_held(p_job, p_runner) then return false; end if;
  select * into v_row from public.import_job_rows where job_id = p_job and idx = p_idx for update;
  if v_row.job_id is null then return true; end if;
  -- Not matched yet, or decided already: nothing to save (a second save is a no-op).
  if v_row.state <> 'done' or v_row.cover_state = 'done' then return true; end if;
  if coalesce((p_result ->> 'retry')::boolean, false) then
    update public.import_job_rows
       set cover_tries = cover_tries + 1, cover_taken_by = null, cover_attempts = 0,
           cover_not_before = now() + make_interval(secs => least(greatest(coalesce((p_result ->> 'wait_seconds')::integer, 0), 0), 3600))
     where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  if p_result ->> 'next' = 'goodreads' then
    update public.import_job_rows
       set cover_state = 'goodreads', cover_tries = 0, cover_not_before = null, cover_taken_by = null, cover_attempts = 0
     where job_id = p_job and idx = p_idx;
    update public.import_jobs set progress_at = clock_timestamp() where id = p_job;
    return true;
  end if;
  if v_source not in ('openlibrary', 'goodreads', 'none') or (v_source <> 'none' and v_url !~ '^https://[^[:space:]]+$') then
    raise exception 'cover_invalid' using errcode = '22023';
  end if;
  update public.import_job_rows
     set cover_state = 'done', cover_source = v_source, cover_taken_by = null, cover_not_before = null,
         cover_url = case when v_source = 'none' then null else v_url end,
         cover_size = case when v_source <> 'none' and (p_result ->> 'size') in ('S', 'M', 'L') then p_result ->> 'size' end
   where job_id = p_job and idx = p_idx;
  update public.import_jobs
     set cover_openlibrary = cover_openlibrary + (v_source = 'openlibrary')::integer,
         cover_goodreads = cover_goodreads + (v_source = 'goodreads')::integer,
         cover_none = cover_none + (v_source = 'none')::integer,
         progress_at = clock_timestamp(),
         lease_until = greatest(lease_until, now() + interval '170 seconds')
   where id = p_job
  returning member_id into v_member;
  update public.import_queue set beat_at = clock_timestamp() where member_id = v_member and holder = 'job:' || p_job::text;
  return true;
end
$$;

-- --------------------------------------------------------------- the release

-- `import_job_release` of 20261102010000_import_jobs.sql, whole, with a fourth argument. The change: the job is done when
-- no row is left to match and no row is left without its cover decision; a chunk ended with `p_wait_until` (Goodreads
-- blocked: the stage waits), or with nothing due but rows waiting for a retry (`cover_not_before`), pauses the job until
-- then, without a fault: it gives the slot up, the tick queues it again when it is time, and the wait counts as progress
-- (no stall). Answers 'done', 'more', 'paused' or 'gone'.
drop function public.import_job_release(uuid, text, text);
create function public.import_job_release(p_job uuid, p_runner text, p_error text default null, p_wait_until timestamptz default null)
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
  if not exists (select 1 from public.import_job_rows where job_id = p_job and cover_state <> 'done') then
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

revoke all on function public.import_job_take_cover_rows(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.import_job_save_cover(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.import_job_release(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.import_job_take_cover_rows(uuid, text, integer) to service_role;
grant execute on function public.import_job_save_cover(uuid, text, integer, jsonb) to service_role;
grant execute on function public.import_job_release(uuid, text, text, timestamptz) to service_role;
