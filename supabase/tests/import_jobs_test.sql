-- The import as a server job (supabase test db): a member starts a job with her parsed rows, it takes the import
-- queue's slot as holder 'job:<id>', the runner claims it in chunks (a lease; never two runners), takes and saves
-- rows, releases (done / more / paused), a dead runner's lease runs out and the next one resumes without
-- duplicating rows, a row that keeps killing runners is given up, and the tick fails stalled jobs. See
-- 20261102010000_import_jobs.sql.

begin;
select plan(98);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-JOBS', 'import jobs test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-JOBS'), now(), now(), now());
  return v_id;
end;
$$;
create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create or replace function tests.rows(p_n integer)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'goodreads:' || i, 'title', 'Book ' || i, 'authors', jsonb_build_array('A. Author')))
    from generate_series(1, p_n) i
$$;
create or replace function tests.job(p_id uuid)
returns text language sql security definer as $$
  select concat_ws(',', state, done, added, kept, failed, needs_look, coalesce(runner, '-')) from public.import_jobs where id = p_id
$$;
create or replace function tests.place(p_member uuid)
returns text language sql security definer as $$
  select concat_ws(',', holder, (started_at is not null)::text, done) from public.import_queue where member_id = p_member
$$;
create or replace function tests.expire_lease(p_job uuid)
returns void language sql security definer as $$
  update public.import_jobs set lease_until = now() - interval '1 second' where id = p_job
$$;
create or replace function tests.age_jobs(p_member uuid)
returns void language sql security definer as $$
  update public.import_jobs set created_at = created_at - interval '1 hour' where member_id = p_member
$$;
create or replace function tests.big_rows(p_n integer)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'big:' || i, 'pad', repeat(md5(i::text), 590)))
    from generate_series(1, p_n) i
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@jobs.pgtap.test') as ada \gset
select tests.member('bo@jobs.pgtap.test') as bo \gset
select tests.member('cy@jobs.pgtap.test') as cy \gset

-- --------------------------------------------------------------- the shape

select has_table('public', 'import_jobs', 'the jobs table is there');
select has_table('public', 'import_job_rows', 'the rows table is there');
select ok(has_table_privilege('authenticated', 'public.import_jobs', 'select')
          and not has_table_privilege('authenticated', 'public.import_jobs', 'insert, update, delete')
          and not has_table_privilege('authenticated', 'public.import_job_rows', 'insert, update, delete')
          and not has_table_privilege('anon', 'public.import_jobs', 'select'),
          'members only read; visitors nothing');
select ok(has_function_privilege('authenticated', 'public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.cancel_import_job(uuid)', 'execute'),
          'members start and cancel a job, visitors do not');
select ok(not has_function_privilege('authenticated', 'public.import_job_claim(text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_job_save_row(uuid, text, integer, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_job_take_rows(uuid, text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_job_release(uuid, text, text, timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_claim(text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_save_row(uuid, text, integer, jsonb)', 'execute'),
          'only the service role runs a job');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'import_jobs'),
          'the app can follow its job over Realtime');

-- ------------------------------------------------------------- starting

select tests.act_as(:'ada');
select throws_ok($$ select public.start_import_job('[]'::jsonb, 'goodreads') $$, '22023', 'rows_invalid', 'no rows, no job');
select throws_ok($$ select public.start_import_job('[{"title": "no key"}]'::jsonb, 'goodreads') $$, '22023', 'rows_invalid', 'a row needs its key');
select throws_ok($$ select public.start_import_job('[{"key": "a"}, {"key": "a"}]'::jsonb, 'goodreads') $$, '22023', 'rows_invalid', 'keys are unique');
select throws_ok($$ select public.start_import_job(tests.rows(1), 'Good Reads') $$, '22023', 'source_invalid', 'the source is a plain name');
select throws_ok(format($$ select public.start_import_job(tests.big_rows(300), 'goodreads') $$), '22023', 'rows_invalid', 'the rows together are capped (5 MB)');
-- The holder 'job:' is the job's own: a device cannot take, beat or leave a place under that name.
select throws_ok($$ select public.import_slot_take('job:' || gen_random_uuid()::text, 5, 'dev-phone') $$, '22023', 'holder_invalid', 'a device cannot take a place held for a job');
select throws_ok($$ select public.import_slot_beat('job:abc') $$, '22023', 'holder_invalid', 'nor beat one');
select throws_ok($$ select public.import_slot_leave('job:abc') $$, '22023', 'holder_invalid', 'nor leave one');
-- Her device import still holds a place: the job does not take it over.
select public.import_slot_take('device:ada-1', 5, 'dev-ada');
select throws_ok($$ select public.start_import_job(tests.rows(1), 'goodreads') $$, '55000', 'device_import_running', 'no job while her device import holds a place');
select public.import_slot_leave('device:ada-1');
select public.start_import_job(tests.rows(5), 'goodreads', 'dev-phone', 2) as job \gset
select is((select count(*)::int from public.import_job_rows where job_id = :'job'), 5, 'her rows are stored with the job');
select is((select row(state, total, already, device)::text from public.import_jobs where id = :'job'), '(queued,5,2,dev-phone)',
          'the job is queued with her counts and device');
select throws_ok($$ select public.start_import_job(tests.rows(1), 'goodreads') $$, '55000', 'import_running', 'one live job at a time');
select is((select state from public.import_job_place(:'job')), 'running', 'nobody else in line: the job has the slot');
reset role;
select is(tests.place(:'ada'), 'job:' || :'job' || ',true,0', 'the job holds her place as job:<id>');

-- Bo cannot see Ada's job.
select tests.act_as(:'bo');
select is((select count(*)::int from public.import_jobs), 0, 'another member sees no job of hers');
select is((select count(*)::int from public.import_job_rows), 0, 'nor its rows');
select is(public.cancel_import_job(:'job'), false, 'nor cancels it');
select throws_ok(format('select * from public.import_job_place(%L)', :'job'), 'P0002', 'job_unknown', 'nor asks where it stands');
reset role;

-- The place does not expire by the 75 s beat rule while the job lives.
update public.import_queue set beat_at = now() - interval '10 minutes' where member_id = :'ada';
select tests.act_as(:'bo');
select is((select row(state, mine, ahead)::text from public.import_slot_take('device:bo-1', 30, 'dev-bo')), '(waiting,t,1)',
          'a device import waits behind a job whose place has not beaten for minutes');
reset role;

-- ------------------------------------------------------------- running

set local role service_role;
select is((select count(*)::int from public.import_job_claim('runner-1')), 1, 'the runner claims the job with the slot');
select is(tests.job(:'job'), 'running,0,0,0,0,0,runner-1', 'running, leased to runner-1');
select is((select count(*)::int from public.import_job_claim('runner-2')), 0, 'a second runner gets nothing while the lease holds');
select is((select count(*)::int from public.import_job_claim('runner-1')), 0, 'nor the same runner id again: the lease holds against anyone, whatever the id');
select is((select string_agg(idx::text, ',' order by idx) from public.import_job_take_rows(:'job', 'runner-1', 3)), '0,1,2',
          'rows come in file order');
select is((select count(*)::int from public.import_job_take_rows(:'job', 'runner-2', 3)), 0, 'a runner without the lease takes nothing');
select is(public.import_job_save_row(:'job', 'runner-1', 0,
          '{"verdict": "matched", "tier": "quiet", "outcome": "added", "cover": "own", "edition": {"via": "isbn"}}'),
          true, 'a row is saved');
select is(public.import_job_save_row(:'job', 'runner-1', 1, '{"verdict": "fromFile", "tier": "needsLook", "outcome": "added", "cover": "none"}'),
          true, 'another');
select is(public.import_job_save_row(:'job', 'runner-1', 2, '{"defer": true}'), true, 'a row a source could not be asked about is deferred');
select is(tests.job(:'job'), 'running,2,2,0,0,1,runner-1', 'the counts follow the saved rows; a deferred one is not done');
select is(public.import_job_save_row(:'job', 'runner-1', 0, '{"verdict": "matched", "outcome": "added"}'), true, 'saving a done row again is a no-op');
select is(tests.job(:'job'), 'running,2,2,0,0,1,runner-1', 'and counts nothing twice');
select is(public.import_job_save_row(:'job', 'runner-2', 3, '{"outcome": "added"}'), false, 'a runner without the lease is told to stop');
reset role;
select is(tests.place(:'ada'), 'job:' || :'job' || ',true,2', 'the queue sees how far the job is');

-- The chunk is over with rows left: the next chunk is due.
set local role service_role;
select is((select string_agg(idx::text, ',' order by idx) from public.import_job_take_rows(:'job', 'runner-1', 2)), '3,4', 'the rest of the first pass');
select is(public.import_job_release(:'job', 'runner-1'), 'more', 'released with rows left: more');
select is((select attempts from public.import_job_rows where job_id = :'job' and idx = 3), 0::smallint,
          'a row handed out but not reached does not count as an attempt');
select is((select count(*)::int from public.import_job_claim('runner-2')), 1, 'the next runner claims it');

-- runner-2 dies mid-chunk (CPU limit): its lease runs out, runner-3 resumes the same rows, nothing is duplicated.
select is((select string_agg(idx::text, ',' order by idx) from public.import_job_take_rows(:'job', 'runner-2', 2)), '3,4', 'runner-2 takes 3 and 4');
select is(public.import_job_save_row(:'job', 'runner-2', 3, '{"verdict": "inLibrary", "tier": "quiet", "outcome": "in_library"}'), true, 'saves 3, then dies');
reset role;
select tests.expire_lease(:'job');
set local role service_role;
select is((select count(*)::int from public.import_job_claim('runner-3')), 1, 'after the lease ran out runner-3 claims the job');
select is(public.import_job_save_row(:'job', 'runner-2', 4, '{"outcome": "added"}'), false, 'the dead runner''s late save is refused');
select is((select string_agg(idx::text || ':' || pass, ',' order by pass, idx) from public.import_job_take_rows(:'job', 'runner-3', 5)), '4:0,2:1',
          'runner-3 resumes the row runner-2 never saved, then the second pass');
select is(public.import_job_save_row(:'job', 'runner-3', 4, '{"verdict": "matched", "tier": "probablyFine", "outcome": "added"}'), true, 'saves 4');
select is(public.import_job_save_row(:'job', 'runner-3', 2, '{"verdict": "matched", "tier": "quiet", "outcome": "failed", "error": "write_failed"}'), true, 'saves the deferred row');
-- Row 1 matched without a cover: the job is not done until its cover is decided (import_job_covers_test.sql has the stage).
select is(public.import_job_release(:'job', 'runner-3'), 'more', 'every row matched, one still without its cover decision: not done');
select is((select count(*)::int from public.import_job_claim('runner-4')), 1, 'the next chunk');
select is((select string_agg(idx::text, ',') from public.import_job_take_cover_rows(:'job', 'runner-4', 5)), '1', 'the cover stage takes that row');
select is(public.import_job_save_cover(:'job', 'runner-4', 1, '{"source": "none"}'), true, 'and decides it');
select is(public.import_job_release(:'job', 'runner-4'), 'done', 'nothing pending, every cover decided: done');
select is(tests.job(:'job'), 'done,5,3,1,1,1,-', 'every row once: 3 added, 1 kept, 1 failed, 1 to look at');
reset role;
select is(tests.place(:'ada'), null, 'a finished job leaves the line');

-- ------------------------------------------------------- as the member

-- Bo's device import (waiting since above) gives up its place.
select tests.act_as(:'bo');
select public.import_slot_leave('device:bo-1');
reset role;
select tests.act_as(:'ada');
select throws_ok($$ select public.start_import_job(tests.rows(1), 'goodreads') $$, '55000', 'import_too_soon', 'one start per member per 2 minutes');
reset role;
select tests.age_jobs(:'ada');
-- Books for the search below: Bo's own Manual book, a Catalogue Book the check failed, and a plain Catalogue Book.
insert into public.books (title, authors, source, owner_id) values ('Almanac Secret Of Bo', '{Bo Writer}', 'manual', :'bo');
insert into public.books (title, authors, source, check_failed, checked_at) values ('Almanac Planted', '{Some Faker}', 'openlibrary', true, now());
insert into public.books (title, authors, source, isbn13) values ('Almanac Plain', '{Pat Plain}', 'openlibrary', '9780306406157');
select tests.act_as(:'ada');
select public.start_import_job(
  '[{"key": "goodreads:91", "title": "Notes Nobody Printed"}, {"key": "goodreads:92", "title": "Second"}]'::jsonb,
  'goodreads') as job3 \gset
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('runner-w');
select is(public.import_job_write(:'job3', 'runner-w', 0,
          '{"key": "goodreads:91", "book": {"title": "Notes Nobody Printed", "authors": ["Ada Example"], "source": "manual"}, "status": "want_to_read"}') ->> 'outcome',
          'added', 'the runner writes a row through import_books, as her');
select is(auth.uid(), null, 'and nothing after it in the same transaction runs as her');
reset role;
select is((select count(*)::int from public.library_entries where member_id = :'ada' and import_key = 'goodreads:91'), 1,
          'the entry is hers, with the row''s key');
select is((select outcome from public.import_job_rows where job_id = :'job3' and idx = 0), 'added', 'the outcome is recorded with the write');
set local role service_role;
select is(public.import_job_write(:'job3', 'runner-w', 0,
          '{"key": "goodreads:91", "book": {"title": "Notes Nobody Printed", "authors": ["Ada Example"], "source": "manual"}, "status": "want_to_read"}') ->> 'outcome',
          'added', 'writing the row again answers the recorded outcome');
reset role;
select is((select count(*)::int from public.library_entries where member_id = :'ada'), 1, 'and writes nothing twice');
set local role service_role;
select throws_ok(format($$ select public.import_job_write(%L, 'runner-w', 1, '{"key": "goodreads:91"}') $$, :'job3'),
                 '22023', 'row_invalid', 'a payload with another row''s key writes nothing');
select throws_ok(format($$ select public.import_job_write(%L, 'runner-x', 1, '{"key": "goodreads:92"}') $$, :'job3'),
                 '55000', 'lease_lost', 'a runner without the lease writes nothing');
select is((select count(*)::int from public.import_job_search_books(:'job3', 'runner-w', 'Notes Nobody Printed')), 1,
          'the Catalogue search sees her own Manual book, as she does');
-- Not Bo's Manual book, not the Catalogue Book the check failed: only what she could read through the table herself.
select is((select string_agg(title, ',' order by title) from public.import_job_search_books(:'job3', 'runner-w', 'Almanac')), 'Almanac Plain',
          'the Catalogue search shows her neither another member''s Manual book nor a failed Catalogue Book');
select is((select count(*)::int from public.import_job_search_books(:'job3', 'runner-w', 'Almanac Secret Of Bo')), 0,
          'not even by its exact title');
select is(public.import_job_save_row(:'job3', 'runner-w', 1, '{"verdict": "matched"}'), true, 'a result without an outcome or a tier is saved');
select is(tests.job(:'job3'), 'running,1,0,0,0,0,runner-w', 'and counts as neither (no NULL in the counts)');
select is((select count(*)::int from public.import_job_fill_covers(:'job3', 'runner-w', '[]'::jsonb)), 1, 'covers are filled as her');
reset role;
select tests.act_as(:'ada');
select is(public.cancel_import_job(:'job3'), true, 'she cancels her job');
reset role;
select is((select state from public.import_jobs where id = :'job3'), 'cancelled', 'cancelled, what is written stays');
select is((select count(*)::int from public.import_job_rows where job_id = :'job3'), 0, 'her rows go with the cancel');
set local role service_role;
select is(public.import_job_save_row(:'job3', 'runner-w', 1, '{"outcome": "added"}'), false, 'the runner is told to stop');
reset role;

-- ------------------------------------------------------------- failures

-- A row that kills every runner is given up after three attempts.
select tests.act_as(:'bo');
select public.start_import_job(tests.rows(2), 'hardcover') as job2 \gset
reset role;
set local role service_role;
select public.import_job_claim('r-a');
select public.import_job_take_rows(:'job2', 'r-a', 1);
reset role;
select tests.expire_lease(:'job2');
set local role service_role;
select public.import_job_claim('r-b');
select public.import_job_take_rows(:'job2', 'r-b', 1);
reset role;
select tests.expire_lease(:'job2');
set local role service_role;
select public.import_job_claim('r-c');
select public.import_job_take_rows(:'job2', 'r-c', 1);
reset role;
select tests.expire_lease(:'job2');
set local role service_role;
select public.import_job_claim('r-d');
select is((select string_agg(idx::text, ',') from public.import_job_take_rows(:'job2', 'r-d', 5)), '1', 'the poison row is not handed out a fourth time');
select is((select string_agg(title, ',' order by title) from public.import_job_search_books(:'job2', 'r-d', 'Almanac')), 'Almanac Plain,Almanac Secret Of Bo',
          'her own Manual book is hers to find (the control of the search test above)');
select is((select row(outcome, error)::text from public.import_job_rows where job_id = :'job2' and idx = 0), '(failed,gave_up)', 'it is given up');

-- A chunk that fails as a whole pauses the job and frees the slot.
select is(public.import_job_release(:'job2', 'r-d', 'sources_unavailable'), 'paused', 'a failed chunk pauses the job');
reset role;
select is((select row(state, error, not_before > now())::text from public.import_jobs where id = :'job2'), '(paused,sources_unavailable,t)',
          'paused with its reason, until later');
select is(tests.place(:'bo'), null, 'a paused job gives the slot up');
update public.import_jobs set not_before = now() - interval '1 second' where id = :'job2';
select private.import_job_tick();
select is(tests.place(:'bo'), 'job:' || :'job2' || ',true,1', 'when it is time the tick queues it again');

-- The tick fails a running job without progress for 30 minutes.
update public.import_jobs set state = 'running', progress_at = now() - interval '31 minutes' where id = :'job2';
select private.import_job_tick();
select is((select row(state, error)::text from public.import_jobs where id = :'job2'), '(failed,stalled)', 'a stalled job fails');

-- After a crash the rows come one at a time; a row given up keeps the outcome its write recorded.
select tests.act_as(:'cy');
select public.start_import_job(tests.rows(5), 'goodreads') as job4 \gset
reset role;
set local role service_role;
select public.import_job_claim('c-1');
select is((select count(*)::int from public.import_job_take_rows(:'job4', 'c-1', 5)), 5, 'a first chunk takes the batch');
reset role;
select tests.expire_lease(:'job4');
set local role service_role;
select public.import_job_claim('c-2');
select is((select count(*)::int from public.import_job_take_rows(:'job4', 'c-2', 5)), 5, 'and after one crash still the batch');
reset role;
select tests.expire_lease(:'job4');
-- Row 4 was written (the outcome recorded) by a runner that then died three times over.
update public.import_job_rows set outcome = 'added', attempts = 3, taken_by = 'c-2' where job_id = :'job4' and idx = 4;
set local role service_role;
select public.import_job_claim('c-3');
select is((select string_agg(idx::text, ',') from public.import_job_take_rows(:'job4', 'c-3', 5)), '0',
          'after two crashes the suspects come one at a time');
select is(tests.job(:'job4'), 'running,1,1,0,0,1,c-3', 'the written row given up counts as added, not failed');
select is((select row(outcome, error, tier)::text from public.import_job_rows where job_id = :'job4' and idx = 4), '(added,gave_up,needsLook)',
          'it keeps its outcome, and is left for her to look at');
select is((select string_agg(idx::text, ',') from public.import_job_take_rows(:'job4', 'c-3', 5)), '1', 'the next suspect, alone');
select is(public.import_job_release(:'job4', 'c-3', 'sources_unavailable'), 'paused', 'the chunk fails as a whole');
reset role;

-- A job that waited starts its 30 minutes at the claim.
update public.import_jobs set not_before = now() - interval '1 second', progress_at = now() - interval '2 hours' where id = :'job4';
select private.import_job_tick();
set local role service_role;
select is((select count(*)::int from public.import_job_claim('c-4')), 1, 'queued again, claimed');
reset role;
select ok((select progress_at >= now() from public.import_jobs where id = :'job4'), 'its progress clock starts at the claim, not when it was queued');

-- A place held under another member's name does not make a chunk due or claimable.
set local role service_role;
select is(public.import_job_release(:'job4', 'c-4'), 'more', 'chunk over, rows left');
reset role;
select ok(private.import_job_due(), 'the job holding the slot is due');
update public.import_queue set member_id = :'ada' where holder = 'job:' || :'job4';
select ok(not private.import_job_due(), 'not when the place is another member''s');
set local role service_role;
select is((select count(*)::int from public.import_job_claim('c-5')), 0, 'nor claimed');
reset role;

-- A device asking from the job's own device does not take the job's place over.
update public.import_queue set device = 'dev-x' where holder = 'job:' || :'job4';
select tests.act_as(:'ada');
select public.import_slot_take('device:ada-2', 5, 'dev-x');
reset role;
select is((select holder from public.import_queue where member_id = :'ada'), 'job:' || :'job4', 'a device import of the same device does not swap the holder of a job''s place');

select * from finish();
rollback;
