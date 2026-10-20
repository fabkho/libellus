-- The import job's cover stage (20261103010000_import_job_covers.sql): a matched row's cover is decided with its match
-- (edition / lent) or by the stage (Open Library, then Goodreads, else none); the stage starts when every row is matched,
-- Open Library's step before Goodreads', a retry waits for its time, a job with nothing due (or told to wait) pauses
-- without a fault, a row handed out three times unsaved is given up, and the job is done when every row has its cover
-- decision (and its outcome, the write phase). The runner's side (chunks, retries, answers) is Deno (supabase/functions/import-job/covers_test.ts).

begin;
select plan(54);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-COVERS', 'import job covers test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-COVERS'), now(), now(), now());
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
  select concat_ws(',', state, done, coalesce(runner, '-')) from public.import_jobs where id = p_id
$$;
create or replace function tests.covers(p_id uuid)
returns text language sql security definer as $$
  select concat_ws(',', cover_edition, cover_lent, cover_openlibrary, cover_goodreads, cover_none) from public.import_jobs where id = p_id
$$;
create or replace function tests.row_cover(p_id uuid, p_idx integer)
returns text language sql security definer as $$
  select concat_ws(',', cover_state, coalesce(cover_source, '-'), coalesce(cover_url, '-'), coalesce(cover_size, '-'), cover_tries)
    from public.import_job_rows where job_id = p_id and idx = p_idx
$$;
create or replace function tests.expire_lease(p_job uuid)
returns void language sql security definer as $$
  update public.import_jobs set lease_until = now() - interval '1 second' where id = p_job
$$;
-- The write phase is part 4's (import_job_write_test.sql); here a job's rows are just written so the job can finish.
create or replace function tests.write_all(p_job uuid, p_runner text)
returns void language plpgsql security definer as $$
declare v_row record;
begin
  for v_row in select idx from public.import_job_take_write_rows(p_job, p_runner, 50) loop
    perform public.import_job_save_write(p_job, p_runner, v_row.idx, '{"outcome": "added"}');
  end loop;
end;
$$;
create or replace function tests.age_jobs(p_member uuid)
returns void language sql security definer as $$
  update public.import_jobs set created_at = created_at - interval '1 hour' where member_id = p_member
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@covers.pgtap.test') as ada \gset
select tests.member('bo@covers.pgtap.test') as bo \gset

-- --------------------------------------------------------------- the shape

select ok(not has_function_privilege('authenticated', 'public.import_job_take_cover_rows(uuid, text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_job_save_cover(uuid, text, integer, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.import_job_save_cover(uuid, text, integer, jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_take_cover_rows(uuid, text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_save_cover(uuid, text, integer, jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_release(uuid, text, text, timestamptz)', 'execute'),
          'only the service role runs the cover stage');

-- ----------------------------------------------------- decided with the match

select tests.act_as(:'ada');
select public.start_import_job(tests.rows(6), 'goodreads') as job \gset
reset role;
set local role service_role;
select public.import_job_claim('r1');
select is((select count(*)::int from public.import_job_take_cover_rows(:'job', 'r1', 5)), 0, 'no cover stage while rows are still to match');
select public.import_job_take_rows(:'job', 'r1', 6);
select is(public.import_job_save_row(:'job', 'r1', 0, '{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg", "cover_size": "L"}'),
          true, 'a row matched with its own cover');
select is(public.import_job_save_row(:'job', 'r1', 1, '{"verdict": "matched", "tier": "quiet", "cover": "lent", "cover_url": "https://example.org/sibling.jpg"}'),
          true, 'a row matched with a sibling edition''s cover');
select public.import_job_save_row(:'job', 'r1', 2, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_save_row(:'job', 'r1', 3, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_save_row(:'job', 'r1', 4, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_save_row(:'job', 'r1', 5, '{"verdict": "inLibrary", "tier": "quiet"}');
reset role;
select is(tests.row_cover(:'job', 0), 'done,edition,https://covers.openlibrary.org/b/id/1-L.jpg,L,0', 'its own cover: decided, with the address and size');
select is(tests.row_cover(:'job', 1), 'done,lent,https://example.org/sibling.jpg,-,0', 'a lent cover: decided, size unknown');
select is(tests.row_cover(:'job', 2), 'pending,-,-,-,0', 'no cover: pending, Open Library next');
select is(tests.row_cover(:'job', 5), 'done,none,-,-,0', 'a result without a cover to say (already in the Library): decided, none');
select is(tests.covers(:'job'), '1,1,0,0,1', 'the counters follow: 1 edition, 1 lent, 1 none');
select is((select count(*)::int from public.import_job_rows where job_id = :'job' and cover_state <> 'done'), 3, 'three rows are left without a decision');

-- ----------------------------------------------------------- the stage

set local role service_role;
select is((select count(*)::int from public.import_job_take_cover_rows(:'job', 'r2', 5)), 0, 'a runner without the lease takes nothing');
select is(public.import_job_save_cover(:'job', 'r2', 2, '{"source": "none"}'), false, 'nor saves: told to stop');
select is((select string_agg(idx || ':' || cover_state, ',' order by idx) from public.import_job_take_cover_rows(:'job', 'r1', 2)), '2:pending,3:pending',
          'the stage takes rows in file order, Open Library''s step');
select is((select string_agg(idx::text, ',') from public.import_job_take_cover_rows(:'job', 'r1', 5)), '4', 'a row handed out is not handed out again to the same runner');
select is(public.import_job_save_cover(:'job', 'r1', 2, '{"source": "openlibrary", "url": "https://covers.openlibrary.org/b/id/22-L.jpg", "size": "L"}'),
          true, 'Open Library found a cover');
select is(public.import_job_save_cover(:'job', 'r1', 2, '{"source": "none"}'), true, 'a second save of a decided row is a no-op');
select throws_ok(format($$ select public.import_job_save_cover(%L, 'r1', 3, '{"source": "bogus"}') $$, :'job'), '22023', 'cover_invalid', 'a source of nobody''s is refused');
select throws_ok(format($$ select public.import_job_save_cover(%L, 'r1', 3, '{"source": "goodreads", "url": "http://insecure.example/x.jpg"}') $$, :'job'), '22023', 'cover_invalid', 'and an address that is not https');
select is(public.import_job_save_cover(:'job', 'r1', 3, '{"next": "goodreads"}'), true, 'Open Library had none: Goodreads next');
select is(public.import_job_save_cover(:'job', 'r1', 4, '{"retry": true, "wait_seconds": 0}'), true, 'Open Library failed once: one try more');
reset role;
select is(tests.row_cover(:'job', 2), 'done,openlibrary,https://covers.openlibrary.org/b/id/22-L.jpg,L,0', 'the decided row keeps its first decision');
select is(tests.row_cover(:'job', 3), 'goodreads,-,-,-,0', 'row 3 waits for Goodreads');
select is(tests.row_cover(:'job', 4), 'pending,-,-,-,1', 'row 4 is charged a try');
select is(tests.covers(:'job'), '1,1,1,0,1', 'one Open Library cover counted once');

-- Goodreads at the end: not before Open Library's step is through for EVERY row.
select tests.expire_lease(:'job');
set local role service_role;
select public.import_job_claim('r3');
select is((select string_agg(idx || ':' || cover_state, ',') from public.import_job_take_cover_rows(:'job', 'r3', 5)), '4:pending',
          'row 4 is still in Open Library''s step: Goodreads'' row 3 waits');
select public.import_job_save_cover(:'job', 'r3', 4, '{"next": "goodreads"}');
select is((select string_agg(idx || ':' || cover_state || ':' || cover_tries, ',' order by idx) from public.import_job_take_cover_rows(:'job', 'r3', 5)), '3:goodreads:0,4:goodreads:0',
          'then Goodreads'' step, for every row still without a cover');
select is(public.import_job_save_cover(:'job', 'r3', 3, '{"retry": true, "wait_seconds": 30}'), true, 'row 3: unsure, asked again in 30 s');
select is(public.import_job_save_cover(:'job', 'r3', 4, '{"source": "goodreads", "url": "https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1l/2.jpg", "size": "L"}'),
          true, 'row 4: Goodreads has a cover');
-- Nothing due but a row waiting for its retry: the job pauses without a fault, the slot goes to the next import.
select is(public.import_job_release(:'job', 'r3'), 'paused', 'only a row waiting for its time is left: the job waits');
reset role;
select is((select row(state, error, not_before > now() + interval '20 seconds', not_before < now() + interval '40 seconds')::text from public.import_jobs where id = :'job'),
          '(paused,,t,t)', 'paused until the retry is due, with no error');
select is((select count(*)::int from public.import_queue where holder = 'job:' || :'job'), 0, 'its place in the queue is given up meanwhile');
select is(tests.row_cover(:'job', 3), 'goodreads,-,-,-,1', 'the unsure row has been charged one try');

-- When it is time the tick queues it again; the row is due, asked, and the job is done.
update public.import_jobs set not_before = now() - interval '1 second' where id = :'job';
update public.import_job_rows set cover_not_before = now() - interval '1 second' where job_id = :'job' and idx = 3;
select private.import_job_tick();
set local role service_role;
select is((select count(*)::int from public.import_job_claim('r4')), 1, 'queued again and claimed');
select is((select string_agg(idx::text, ',') from public.import_job_take_cover_rows(:'job', 'r4', 5)), '3', 'the row is due now');
select public.import_job_save_cover(:'job', 'r4', 3, '{"source": "none"}');
select tests.write_all(:'job', 'r4');
select is(public.import_job_release(:'job', 'r4'), 'done', 'every row has its cover decision: done');
reset role;
select is(tests.covers(:'job'), '1,1,1,1,2', 'by source: 1 edition, 1 lent, 1 Open Library, 1 Goodreads, 2 without');
select is((select cover_edition + cover_lent + cover_openlibrary + cover_goodreads + cover_none from public.import_jobs where id = :'job'), 6,
          'every row counted once, in one source');

-- She reads her rows'' covers (RLS: her own rows, the new columns too).
select tests.act_as(:'ada');
select is((select string_agg(cover_source, ',' order by idx) from public.import_job_rows where job_id = :'job'), 'edition,lent,openlibrary,none,goodreads,none',
          'her rows say where each cover came from');
reset role;

-- ---------------------------------------------------- told to wait (blocked)

select tests.act_as(:'bo');
select public.start_import_job(tests.rows(2), 'goodreads') as job2 \gset
reset role;
set local role service_role;
select public.import_job_claim('b1');
select public.import_job_take_rows(:'job2', 'b1', 2);
select public.import_job_save_row(:'job2', 'b1', 0, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_save_row(:'job2', 'b1', 1, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_take_cover_rows(:'job2', 'b1', 5);
select public.import_job_save_cover(:'job2', 'b1', 0, '{"next": "goodreads"}');
select public.import_job_save_cover(:'job2', 'b1', 1, '{"next": "goodreads"}');
select is((select count(*)::int from public.import_job_take_cover_rows(:'job2', 'b1', 5)), 2, 'both rows are asked at Goodreads');
-- Goodreads says it is blocking us: the runner leaves its rows unsaved and waits for the job.
select is(public.import_job_release(:'job2', 'b1', null, now() + interval '10 minutes'), 'paused', 'told to wait: the job pauses');
reset role;
select is((select row(state, error, not_before > now() + interval '9 minutes', stalls)::text from public.import_jobs where id = :'job2'), '(paused,,t,0)',
          'for ten minutes, with no error');
select is(tests.row_cover(:'job2', 0), 'goodreads,-,-,-,0', 'its rows are not charged a try for it');
select is((select cover_taken_by is null and cover_attempts = 0 from public.import_job_rows where job_id = :'job2' and idx = 0), true,
          'and are free to be taken again when the job goes on');
update public.import_jobs set not_before = now() - interval '1 second' where id = :'job2';
select private.import_job_tick();
set local role service_role;
select is((select count(*)::int from public.import_job_claim('b2')), 1, 'after the wait the job goes on (it is no stall: the wait counted as progress)');
select is((select count(*)::int from public.import_job_take_cover_rows(:'job2', 'b2', 5)), 2, 'and its rows are asked');
select public.import_job_save_cover(:'job2', 'b2', 0, '{"source": "goodreads", "url": "https://i.gr-assets.com/images/S/x/books/1l/3.jpg"}');
select public.import_job_save_cover(:'job2', 'b2', 1, '{"source": "none"}');
select tests.write_all(:'job2', 'b2');
select is(public.import_job_release(:'job2', 'b2'), 'done', 'done');
reset role;
select is(tests.covers(:'job2'), '0,0,0,1,1', 'one Goodreads cover, one without');

-- ----------------------------------------------------------- a poison row

select tests.age_jobs(:'ada');
select tests.act_as(:'ada');
select public.start_import_job(tests.rows(2), 'goodreads') as job3 \gset
reset role;
set local role service_role;
select public.import_job_claim('p1');
select public.import_job_take_rows(:'job3', 'p1', 2);
select public.import_job_save_row(:'job3', 'p1', 0, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
select public.import_job_save_row(:'job3', 'p1', 1, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
reset role;
-- Row 0 killed three runners in the cover stage.
update public.import_job_rows set cover_attempts = 3, cover_taken_by = 'dead' where job_id = :'job3' and idx = 0;
set local role service_role;
select is((select string_agg(idx::text, ',') from public.import_job_take_cover_rows(:'job3', 'p1', 5)), '1', 'a row handed out three times is not handed out a fourth time');
reset role;
select is(tests.row_cover(:'job3', 0), 'done,none,-,-,0', 'it is given up: decided, no cover');
select is(tests.covers(:'job3'), '0,0,0,0,1', 'and counted');
set local role service_role;
select public.import_job_save_cover(:'job3', 'p1', 1, '{"source": "none"}');
select tests.write_all(:'job3', 'p1');
select is(public.import_job_release(:'job3', 'p1'), 'done', 'the job does not wait for it');

-- A row given up in the match has its cover decided too, so the job can finish.
reset role;
select tests.age_jobs(:'bo');
select tests.act_as(:'bo');
select public.start_import_job(tests.rows(1), 'goodreads') as job4 \gset
reset role;
update public.import_job_rows set attempts = 3, taken_by = 'dead' where job_id = :'job4' and idx = 0;
set local role service_role;
select public.import_job_claim('g1');
select is((select count(*)::int from public.import_job_take_rows(:'job4', 'g1', 5)), 0, 'the poison row of the match is given up');
select is(public.import_job_release(:'job4', 'g1'), 'done', 'nothing left to match or cover: done');
reset role;
select is(tests.covers(:'job4'), '0,0,0,0,1', 'its cover is decided: none');

select * from finish();
rollback;
