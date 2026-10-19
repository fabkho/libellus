-- The import as a server job (proposal #329, owner decision 2026-10-19: "the import moves to a server job; the
-- member can close the app; the UI shows the job's progress").
--
-- The device reads the file as before and uploads its parsed rows; the job looks every row up, writes it
-- (`import_books`, unchanged) and records what it found, so the member reviews the rows that need a look after
-- the job, from `import_job_rows`. Nothing new leaves the device beyond what the import writes anyway.
--
--   public.import_jobs       one import: its member and device, its state, its counts, the runner holding it
--   public.import_job_rows   the file's rows (as the device parsed them) and, once done, each one's result
--
-- States: queued (waiting for the import queue's slot), running (holds the slot; a chunk runs or is due),
-- paused (a chunk failed as a whole, e.g. the sources were down: it gives the slot up and queues again at
-- `not_before`), done, failed (gave up: no progress for 30 minutes, or five chunks in a row without one),
-- cancelled (by her).
--
-- The runner (the `import-job` edge function, supabase/functions/import-job) works in chunks, because a 709-row
-- import takes ~10 minutes of lookups and an edge function lives 150 s (Supabase Free; 2 s of CPU):
--
--   import_job_claim(runner)        the job holding the queue's slot, leased to this runner for 170 s (longer than
--                                   a function can live, so a dead runner's lease always runs out); nothing while
--                                   any lease is valid (the runner id must be unique per invocation): never two runners on one job
--   import_job_take_rows(job, runner, n)
--                                   the next n pending rows (first pass in file order, then the second pass); a row
--                                   handed out three times without being saved (it kills the runner) is given up
--   import_job_save_row(job, runner, idx, result)
--                                   one row done (or deferred to the second pass: a source could not be asked);
--                                   the counts, the job's progress and the queue's beat in one statement. Answers
--                                   false when the runner must stop (cancelled, or the lease went to another runner)
--   import_job_release(job, runner, error)
--                                   the chunk is over: done when no row is pending, else the next chunk is kicked
--                                   at once (pg_net, self-chaining); with an error the job pauses
--   import_job_search_books / import_job_write / import_job_fill_covers
--                                   the app's own `search_books`, `import_books` and `fill_book_covers`, run as the
--                                   job's member for the runner holding the lease (below, "as the member")
--
-- Re-triggering: the release kicks the next chunk through pg_net the moment one ends (`private.import_job_kick`);
-- pg_cron's `import-job-tick` (every minute) is the safety net: it kicks a job whose lease ran out (a runner killed
-- by the CPU limit, a lost request), queues paused jobs again when it is time, fails stalled ones and purges old
-- rows. A row is idempotent: its write is `import_books`, which answers `imported` for a key written before, and
-- `import_job_write` records the outcome with the write in one transaction.
--
-- The queue (20261030020000_import_queue.sql) is shared with device imports: a job holds a place as holder
-- 'job:<id>', which never expires by the 75 s beat rule while its job is queued or running (the runner beats it
-- with every saved row, but between chunks and while waiting in line nothing does).
--
-- Members read their own jobs and rows (RLS; `import_jobs` is in the Realtime publication: the app follows its job
-- over a WebSocket while it runs). Only the functions here write. Rows are deleted 30 days after the job ends (they
-- name her books); the job keeps its counts.
--
-- The function's address and secret, once, by the owner (supabase/functions/import-job/README.md):
--
--   update private.import_job_settings set function_url = 'https://<ref>.supabase.co/functions/v1/import-job';
--   select vault.create_secret('<the IMPORT_JOB_TOKEN function secret>', 'import_job_token');
--
-- Refusals: not_signed_in (42501), rows_invalid / source_invalid / device_invalid / already_invalid / languages_invalid (22023),
-- import_running (55000: she has a live job), device_import_running (55000: her device import still holds a place in the
-- queue: it leaves first, import_slot_leave), import_too_soon (55000: one start per member per 2 minutes), job_unknown (P0002).
-- Rows: at most 10000, 20 kB each and 5 MB together (rows_invalid); they are deleted when she cancels.

create schema if not exists private;

-- ------------------------------------------------------------------ tables

create table public.import_jobs (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references auth.users (id) on delete cascade,
  -- The device that started it (the app's stable id, as in import_queue.device).
  device      text check (device is null or char_length(device) between 1 and 64),
  -- The app the file came from ('goodreads', 'hardcover', …).
  source      text not null check (source ~ '^[a-z]{1,20}$'),
  -- The device's languages, first first (the lookups rank editions by them, as on the device: data/search.ts).
  languages   text[] not null default '{}' check (cardinality(languages) <= 5),
  state       text not null default 'queued'
              check (state in ('queued', 'running', 'paused', 'done', 'failed', 'cancelled')),
  -- Rows uploaded, rows done, and what they came to.
  total       integer not null check (total between 1 and 10000),
  done        integer not null default 0 check (done >= 0),
  added       integer not null default 0,
  kept        integer not null default 0,
  failed      integer not null default 0,
  needs_look  integer not null default 0,
  -- Rows the device already knew were there (imported before, or hers under another edition): never uploaded.
  already     integer not null default 0 check (already between 0 and 100000),
  -- The runner holding it, until when, and since when.
  runner      text check (runner is null or char_length(runner) between 1 and 64),
  lease_until timestamptz,
  claimed_at  timestamptz,
  chunks      integer not null default 0,
  -- Chunks in a row that saved nothing (five: failed).
  stalls      integer not null default 0,
  -- Paused until.
  not_before  timestamptz,
  error       text check (error is null or char_length(error) <= 500),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  -- The last row saved (or the start): a running job without progress for 30 minutes is failed.
  progress_at timestamptz not null default now(),
  finished_at timestamptz
);

-- One live job per member.
create unique index import_jobs_one_live on public.import_jobs (member_id) where state in ('queued', 'running', 'paused');
create index import_jobs_member on public.import_jobs (member_id, created_at desc);
create index import_jobs_live on public.import_jobs (created_at) where state in ('queued', 'running', 'paused');
create index import_jobs_finished on public.import_jobs (finished_at) where finished_at is not null;

comment on table public.import_jobs is
  'An import run on the server (supabase/functions/import-job): state, counts, the runner leasing it. '
  'Members read their own; written only by the import job functions.';

create table public.import_job_rows (
  job_id   uuid not null references public.import_jobs (id) on delete cascade,
  idx      integer not null check (idx between 0 and 9999),
  key      text not null check (char_length(key) between 1 and 300),
  -- The file's row as the device parsed it (data/import/rows.ts ImportBook) and the Collections she kept for it.
  payload  jsonb not null check (jsonb_typeof(payload) = 'object'),
  state    text not null default 'pending' check (state in ('pending', 'done')),
  -- 0: the first pass; 1: the second (a source could not be asked the first time).
  pass     smallint not null default 0 check (pass between 0 and 1),
  -- Times handed to a runner, and to which one now.
  attempts smallint not null default 0,
  taken_by text,
  -- The result.
  verdict  text check (verdict in ('matched', 'fromFile', 'inLibrary', 'imported')),
  tier     text check (tier in ('quiet', 'probablyFine', 'needsLook')),
  outcome  text check (outcome in ('added', 'imported', 'in_library', 'failed')),
  entry_id uuid references public.library_entries (id) on delete set null,
  error    text check (error is null or char_length(error) <= 200),
  -- What the match found (the edition, how, its notes): what the review after the job shows.
  edition  jsonb,
  cover    text check (cover in ('own', 'lent', 'goodreads', 'none')),
  done_at  timestamptz,
  primary key (job_id, idx)
);

create index import_job_rows_pending on public.import_job_rows (job_id, pass, idx) where state = 'pending';
create index import_job_rows_entry on public.import_job_rows (entry_id) where entry_id is not null;

comment on table public.import_job_rows is
  'The rows of an import job (the file as the device parsed it) and each one''s result. Members read their own; '
  'deleted 30 days after the job ends.';

alter table public.import_jobs enable row level security;
alter table public.import_job_rows enable row level security;
revoke all on public.import_jobs from public, anon, authenticated;
revoke all on public.import_job_rows from public, anon, authenticated;
grant select on public.import_jobs to authenticated;
grant select on public.import_job_rows to authenticated;
grant select, insert, update, delete on public.import_jobs to service_role;
grant select, insert, update, delete on public.import_job_rows to service_role;

create policy import_jobs_own on public.import_jobs for select to authenticated
  using (member_id = (select auth.uid()));
create policy import_job_rows_own on public.import_job_rows for select to authenticated
  using (exists (select 1 from public.import_jobs j where j.id = job_id and j.member_id = (select auth.uid())));

-- The app follows its job while it runs (Realtime postgres_changes, RLS applies).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.import_jobs;
  end if;
end;
$$;

-- --------------------------------------------------------- the queue

-- The queue's sweep, from 20261030020000_import_queue.sql; the one change: a job's place ('job:<id>') does not
-- expire by the beat while its job is queued or running (nothing beats it between chunks or while it waits in
-- line), and it goes as soon as its job is anything else.
create or replace function private.import_slot_sweep()
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  delete from public.import_queue q
   where case
           when q.holder like 'job:%' then not exists (
             select 1 from public.import_jobs j
              where 'job:' || j.id::text = q.holder and j.state in ('queued', 'running'))
           else q.beat_at < clock_timestamp() - private.import_slot_ttl()
         end;
  if not exists (select 1 from public.import_queue where started_at is not null) then
    update public.import_queue
       set started_at = clock_timestamp()
     where member_id = (
       select q.member_id from public.import_queue q order by q.joined_at, q.member_id limit 1
     );
  end if;
end
$$;

-- The job takes her place in line (or the slot), as holder 'job:<id>'. start_import_job refuses while a device import
-- of hers holds a place, so the conflict branch only ever refreshes the job's own place. Under the queue's lock.
create function private.import_job_enqueue(p_job uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_job public.import_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  select * into v_job from public.import_jobs where id = p_job;
  if v_job.id is null or v_job.state not in ('queued', 'running') then return; end if;
  insert into public.import_queue as q (member_id, holder, rows, done, device)
  values (v_job.member_id, 'job:' || v_job.id::text, v_job.total, v_job.done, v_job.device)
  on conflict (member_id) do update
    set holder = excluded.holder, rows = excluded.rows, done = excluded.done, device = excluded.device,
        beat_at = clock_timestamp()
    where q.holder is distinct from excluded.holder;
  perform private.import_slot_sweep();
end
$$;

-- The job leaves the line (done, failed, cancelled, paused); the slot goes to the next at once.
create function private.import_job_dequeue(p_job uuid)
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  delete from public.import_queue where holder = 'job:' || p_job::text;
  perform private.import_slot_sweep();
end
$$;

-- --------------------------------------------------------- the kick

create table private.import_job_settings (
  id              boolean primary key default true check (id),
  -- The function's address; null = off (nothing is sent: the jobs wait; the local stack runs them by hand).
  function_url    text check (function_url ~ '^https?://[^[:space:]]+$'),
  -- The tick does not kick again sooner than this after the last kick (a chunk's own kick is never held back).
  min_interval    interval not null default interval '50 seconds',
  last_kick_at    timestamptz,
  last_request_id bigint
);

comment on table private.import_job_settings is
  'Where the import-job edge function is (null = off) and when it was last called. One row. Its token is the '
  'Vault secret import_job_token.';

insert into private.import_job_settings default values;
revoke all on private.import_job_settings from public, anon, authenticated;

-- Whether a chunk is due: the job holding the slot has no runner, or its runner's lease ran out.
create function private.import_job_due()
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.import_jobs j
      join public.import_queue q on q.holder = 'job:' || j.id::text and q.member_id = j.member_id and q.started_at is not null
     where j.state in ('queued', 'running')
       and (j.lease_until is null or j.lease_until < now())
  )
$$;

-- Calls the function for the next chunk when one is due. `p_now`: a chunk just ended (self-chaining), not held back
-- by `min_interval`. Answers 'off', 'idle', 'debounced', 'unavailable' or 'sent'.
create function private.import_job_kick(p_now boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.import_job_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.import_job_settings where id;
  if v_settings.function_url is null then return 'off'; end if;
  if not private.import_job_due() then return 'idle'; end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'import_job_token';
  if nullif(btrim(v_token), '') is null then return 'unavailable'; end if;

  update private.import_job_settings
     set last_kick_at = now()
   where id and (p_now or coalesce(last_kick_at, '-infinity') <= now() - min_interval);
  if not found then return 'debounced'; end if;

  -- pg_net sends after this transaction commits and waits in the background: as long as a chunk may run.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 150000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'run'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token), 'Content-Type', 'application/json');
  update private.import_job_settings set last_request_id = v_request where id;
  return 'sent';
end
$$;

-- ------------------------------------------------------------ member

-- Starts her import: the rows the device parsed (and found not there yet), as one job; it queues for the slot at
-- once. Answers the job's id.
create function public.start_import_job(p_rows jsonb, p_source text, p_device text default null, p_already integer default 0,
                                        p_languages text[] default '{}')
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
  perform private.import_job_enqueue(v_job);
  -- Member-triggered: held back by the debounce (the tick, every minute, is the safety net).
  perform private.import_job_kick(false);
  return v_job;
end
$$;

-- She stops her import: what is written stays written; the rest is not looked up.
create function public.cancel_import_job(p_job uuid)
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
  perform private.import_job_kick(false);
  return true;
end
$$;

-- Where her live job stands in the queue (the device's import_slot_* answer, for a job): 'running', 'waiting'
-- (with how many imports are ahead and their rows left) or 'none'.
create function public.import_job_place(p_job uuid)
returns table (state text, ahead integer, rows_ahead integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not exists (select 1 from public.import_jobs where id = p_job and member_id = v_member) then
    raise exception 'job_unknown' using errcode = 'P0002';
  end if;
  return query select s.state, s.ahead, s.rows_ahead from private.import_slot_state(v_member, 'job:' || p_job::text) s;
end
$$;

-- ------------------------------------------------------------ runner

-- The job holding the slot, leased to `p_runner`; nothing when no job has the slot or any lease is valid
-- (the same runner id too: a runner id is unique per invocation, the lease is what keeps two apart).
create function public.import_job_claim(p_runner text, p_lease_seconds integer default 170)
returns setof public.import_jobs
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.import_jobs;
begin
  if p_runner is null or char_length(p_runner) not between 1 and 64 then
    raise exception 'runner_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  select j.* into v_job
    from public.import_jobs j
    join public.import_queue q on q.holder = 'job:' || j.id::text and q.member_id = j.member_id and q.started_at is not null
   where j.state in ('queued', 'running')
   for update of j;
  if v_job.id is null then return; end if;
  if v_job.lease_until is not null and v_job.lease_until >= now() then return; end if;
  -- The last chunk saved nothing: one stall more (five in a row: given up). A first claim is no stall.
  if v_job.claimed_at is not null and v_job.progress_at <= v_job.claimed_at then
    v_job.stalls := v_job.stalls + 1;
  else
    v_job.stalls := 0;
  end if;
  if v_job.stalls >= 5 then
    update public.import_jobs
       set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null, stalls = v_job.stalls
     where id = v_job.id;
    perform private.import_job_dequeue(v_job.id);
    return;
  end if;
  return query
    update public.import_jobs
       set state = 'running', started_at = coalesce(started_at, now()), runner = p_runner, claimed_at = now(),
           lease_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 170), 600))),
           chunks = chunks + 1, stalls = v_job.stalls, not_before = null,
           -- A job that waited (queued, paused) has had no chance to progress: its 30 minutes start now.
           progress_at = case when v_job.state = 'running' then progress_at else now() end
     where id = v_job.id
    returning *;
end
$$;

-- Whether `p_runner` still holds the job (running, its runner).
create function private.import_job_held(p_job uuid, p_runner text)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.import_jobs where id = p_job and state = 'running' and runner = p_runner)
$$;

-- The next rows to work on: pending ones not with this runner already, the first pass in file order before the
-- second. A row handed out three times without being saved killed its runners: it is given up (failed unless its write
-- was recorded: that outcome stands). After a crash (rows handed out twice already) the suspects come one at a time,
-- so the row that kills its runner is found alone and the others of its batch are not blamed.
create function public.import_job_take_rows(p_job uuid, p_runner text, p_limit integer default 8)
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
           taken_by = null, done_at = now()
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
           needs_look = needs_look + v_gave_up, progress_at = clock_timestamp()
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

-- One row done: `p_result` = { verdict, tier, outcome, entry_id, error, edition, cover }, or { defer: true } for a
-- row a source could not be asked about in the first pass (it comes back in the second). Answers whether the runner
-- goes on (false: cancelled, or the job is another runner's now).
create function public.import_job_save_row(p_job uuid, p_runner text, p_idx integer, p_result jsonb)
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
  update public.import_job_rows
     set state = 'done', taken_by = null, done_at = now(),
         verdict = p_result ->> 'verdict',
         tier = v_tier,
         -- A write recorded already (import_job_write) stands.
         outcome = coalesce(v_row.outcome, v_outcome),
         entry_id = coalesce(v_row.entry_id, nullif(p_result ->> 'entry_id', '')::uuid),
         error = left(coalesce(v_row.error, p_result ->> 'error'), 200),
         edition = p_result -> 'edition',
         cover = p_result ->> 'cover'
   where job_id = p_job and idx = p_idx
  returning outcome into v_outcome;
  update public.import_jobs
     set done = done + 1,
         -- A result without an outcome or a tier counts as neither (a NULL would void the count).
         added = added + coalesce((v_outcome = 'added')::integer, 0),
         kept = kept + coalesce((v_outcome in ('imported', 'in_library'))::integer, 0),
         failed = failed + coalesce((v_outcome = 'failed')::integer, 0),
         needs_look = needs_look + coalesce((v_tier = 'needsLook')::integer, 0),
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

-- The chunk is over. Answers 'done' (no row pending: the job is finished and leaves the line), 'more' (the next
-- chunk is kicked at once), 'paused' (`p_error`: the chunk failed as a whole; the job gives the slot up and queues
-- again in a minute, two, four … at most 15) or 'gone' (not this runner's job any more).
create function public.import_job_release(p_job uuid, p_runner text, p_error text default null)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.import_jobs;
begin
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  select * into v_job from public.import_jobs where id = p_job for update;
  if v_job.id is null or v_job.state <> 'running' or v_job.runner is distinct from p_runner then return 'gone'; end if;
  -- Rows handed out but not reached: the runner stopped in time, which is no fault of theirs (only a runner that dies
  -- leaves a row's attempt counted).
  update public.import_job_rows set taken_by = null, attempts = greatest(attempts - 1, 0)
   where job_id = p_job and state = 'pending' and taken_by = p_runner;
  if not exists (select 1 from public.import_job_rows where job_id = p_job and state = 'pending') then
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
  update public.import_jobs set runner = null, lease_until = null where id = p_job;
  perform private.import_job_kick(true);
  return 'more';
end
$$;

-- pg_cron, every minute: paused jobs queue again when it is time, a queued job that lost its place takes one again,
-- a running job without progress for 30 minutes is failed, rows of jobs that ended 30 days ago go, and a chunk that
-- is due (a runner's lease ran out, a kick got lost) is kicked.
create function private.import_job_tick()
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
  return private.import_job_kick(false);
end
$$;

-- ------------------------------------------------------- as the member

-- The job writes for a member who is not in the app. It does so through the very functions the app calls
-- (`search_books`, `import_books`, `fill_book_covers`: their rules, limits and checks unchanged), run as the job's
-- member: `request.jwt.claims` is set for this transaction only, so `auth.uid()` is hers inside them. Only for the
-- runner holding the job (its lease), never for any member the caller names: the member comes from the job row.
create function private.import_job_as_member(p_job uuid, p_runner text)
returns text[]
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_member uuid;
  v_before text[] := array[current_setting('request.jwt.claims', true), current_setting('request.jwt.claim.sub', true),
                           current_setting('request.jwt.claim.role', true)];
begin
  select member_id into v_member from public.import_jobs where id = p_job and state = 'running' and runner = p_runner;
  if v_member is null then raise exception 'lease_lost' using errcode = '55000'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_member::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  return v_before;
end
$$;

-- The caller's claims again (what `import_job_as_member` answered), so nothing after the call in the same
-- transaction runs as her.
create function private.import_job_as_caller(p_before text[])
returns void
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform set_config('request.jwt.claims', coalesce(p_before[1], ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(p_before[2], ''), true);
  perform set_config('request.jwt.claim.role', coalesce(p_before[3], ''), true);
end
$$;

-- The Catalogue search as the member sees it (her own Manual books among the Catalogue's). `search_books` applies the
-- `books_readable` rule itself (it is SECURITY DEFINER, with `auth.uid()` = the member here); this wrapper applies it
-- again, word for word (20261025020000_catalogue_check.sql), because it hands rows to a caller that is not her: another
-- member's Manual book, or a Catalogue Book the check failed and she does not hold, must never come back.
create function public.import_job_search_books(p_job uuid, p_runner text, p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before text[] := private.import_job_as_member(p_job, p_runner);
  v_member uuid := (select member_id from public.import_jobs where id = p_job);
begin
  return query
    select b.*
      from public.search_books(p_query, p_limit) b
     where b.owner_id = v_member
        or (b.owner_id is null
            and (not b.check_failed
                 or exists (select 1 from public.library_entries e where e.member_id = v_member and e.book_id = b.id)));
  perform private.import_job_as_caller(v_before);
end
$$;

-- One row written as the member (`import_books`, one row) and its outcome recorded on the job's row in the same
-- transaction: a row written once is never written twice, whatever happens to the runner after (a second call
-- answers the recorded outcome and writes nothing).
create function public.import_job_write(p_job uuid, p_runner text, p_idx integer, p_row jsonb)
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

-- Covers for Catalogue Books that have none, as the member (`fill_book_covers`: she holds the Book, the address is on
-- the allow-list). Answers how many it filled.
create function public.import_job_fill_covers(p_job uuid, p_runner text, p_covers jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_before text[] := private.import_job_as_member(p_job, p_runner);
  v_filled integer;
begin
  v_filled := public.fill_book_covers(p_covers);
  perform private.import_job_as_caller(v_before);
  return v_filled;
end
$$;

-- -------------------------------------------------------------- grants

revoke all on function private.import_job_enqueue(uuid) from public, anon, authenticated;
revoke all on function private.import_job_dequeue(uuid) from public, anon, authenticated;
revoke all on function private.import_job_due() from public, anon, authenticated;
revoke all on function private.import_job_kick(boolean) from public, anon, authenticated;
revoke all on function private.import_job_held(uuid, text) from public, anon, authenticated;
revoke all on function private.import_job_tick() from public, anon, authenticated;
revoke all on function private.import_job_as_member(uuid, text) from public, anon, authenticated;
revoke all on function private.import_job_as_caller(text[]) from public, anon, authenticated;

revoke all on function public.start_import_job(jsonb, text, text, integer, text[]) from public, anon;
revoke all on function public.cancel_import_job(uuid) from public, anon;
revoke all on function public.import_job_place(uuid) from public, anon;
grant execute on function public.start_import_job(jsonb, text, text, integer, text[]) to authenticated;
grant execute on function public.cancel_import_job(uuid) to authenticated;
grant execute on function public.import_job_place(uuid) to authenticated;

revoke all on function public.import_job_claim(text, integer) from public, anon, authenticated;
revoke all on function public.import_job_take_rows(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.import_job_save_row(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.import_job_release(uuid, text, text) from public, anon, authenticated;
grant execute on function public.import_job_claim(text, integer) to service_role;
grant execute on function public.import_job_take_rows(uuid, text, integer) to service_role;
grant execute on function public.import_job_save_row(uuid, text, integer, jsonb) to service_role;
grant execute on function public.import_job_release(uuid, text, text) to service_role;

revoke all on function public.import_job_search_books(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.import_job_write(uuid, text, integer, jsonb) from public, anon, authenticated;
revoke all on function public.import_job_fill_covers(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.import_job_search_books(uuid, text, text, integer) to service_role;
grant execute on function public.import_job_write(uuid, text, integer, jsonb) to service_role;
grant execute on function public.import_job_fill_covers(uuid, text, jsonb) to service_role;

-- ------------------------------------------------------------- pg_cron

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('import-job-tick', '* * * * *', 'select private.import_job_tick()');
    exception when others then
      raise warning 'import-job-tick could not be scheduled (%): jobs run only while a chunk kicks the next one; nothing re-kicks a dead runner or queues a paused job again', sqlerrm;
    end;
  else
    raise warning 'pg_cron is not here: import jobs run only while a chunk kicks the next one; nothing re-kicks a dead runner or queues a paused job again (enable pg_cron, then schedule import-job-tick: see supabase/functions/import-job/README.md)';
  end if;
end;
$$;
