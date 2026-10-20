-- The import job's write phase (supabase test db; proposal #329, part 4; 20261104010000_import_job_write.sql): once every
-- row is matched and has its cover decision, the job writes EVERY row to the member's Library (`import_books`, as her) and
-- hands the covers found for Catalogue Books to `fill_book_covers`; each row has an outcome (added / kept / failed), a
-- row is never written twice (a second write answers the recorded outcome), the phase resumes after a dead runner, a row
-- that kills its runners is given up, and the job is done only when every row has its outcome. The runner's side
-- (chunks, the app's row mapping) is Deno (supabase/functions/import-job/write_test.ts, runner_test.ts).

begin;
select plan(70);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-WRITE', 'import job write test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-WRITE'), now(), now(), now());
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
create or replace function tests.counts(p_id uuid)
returns text language sql security definer as $$
  select concat_ws(',', state, added, kept, failed) from public.import_jobs where id = p_id
$$;
create or replace function tests.row_write(p_id uuid, p_idx integer)
returns text language sql security definer as $$
  select concat_ws(',', write_state, coalesce(outcome, '-'), coalesce(error, '-')) from public.import_job_rows where job_id = p_id and idx = p_idx
$$;
create or replace function tests.expire_lease(p_job uuid)
returns void language sql security definer as $$
  update public.import_jobs set lease_until = now() - interval '1 second' where id = p_job
$$;
create or replace function tests.age_jobs(p_member uuid)
returns void language sql security definer as $$
  update public.import_jobs set created_at = created_at - interval '1 hour' where member_id = p_member
$$;
create or replace function tests.place(p_member uuid)
returns text language sql security definer as $$
  select holder from public.import_queue where member_id = p_member
$$;
create or replace function tests.entries(p_member uuid)
returns integer language sql security definer as $$
  select count(*)::int from public.library_entries where member_id = p_member
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@write.pgtap.test') as ada \gset
select tests.member('bo@write.pgtap.test') as bo \gset

-- A Catalogue Book without a cover, and one with a cover of its own.
insert into public.books (title, authors, isbn13, source) values ('Piranesi', array['Susanna Clarke'], '9781635575637', 'import') returning id as bare \gset
insert into public.books (title, authors, isbn13, source, cover_url) values ('Kindred', array['Octavia Butler'], '9790000001026', 'import', 'https://covers.openlibrary.org/b/id/1-L.jpg')
  returning id as covered \gset

-- --------------------------------------------------------------- the shape

select ok(not has_function_privilege('authenticated', 'public.import_job_take_write_rows(uuid, text, integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.import_job_save_write(uuid, text, integer, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.import_job_save_write(uuid, text, integer, jsonb)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_take_write_rows(uuid, text, integer)', 'execute')
          and has_function_privilege('service_role', 'public.import_job_save_write(uuid, text, integer, jsonb)', 'execute'),
          'only the service role runs the write phase');

-- ------------------------------------------- the phase starts after the covers

select tests.act_as(:'ada');
select public.start_import_job(tests.rows(6), 'goodreads') as job \gset
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('w1');
select is((select count(*)::int from public.import_job_take_write_rows(:'job', 'w1', 10)), 0, 'nothing is written while rows are still to match');
select public.import_job_take_rows(:'job', 'w1', 6);
-- 0: a Catalogue Book without a cover (Open Library will find one); 1: its twin row (she will have it already); 2: the file's own
-- row with a Goodreads cover; 3: a Book with a cover of its own; 4: a row the write refuses (Currently reading without a day);
-- 5: a row without a choice saved.
select public.import_job_save_row(:'job', 'w1', 0, format('{"verdict": "matched", "tier": "quiet", "cover": "none", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9781635575637", "coverUrl": null}, "lent": null, "filled": false}}', :'bare')::jsonb);
select public.import_job_save_row(:'job', 'w1', 1, format('{"verdict": "matched", "tier": "quiet", "cover": "none", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9781635575637", "coverUrl": null}, "lent": null, "filled": false}}', :'bare')::jsonb);
select public.import_job_save_row(:'job', 'w1', 2, '{"verdict": "fromFile", "tier": "needsLook", "cover": "goodreads", "cover_url": "https://i.gr-assets.com/books/1l/2.jpg", "write": {"book": {"title": "Only Goodreads Knows", "authors": ["A. Author"], "isbn13": null, "source": "manual"}, "lent": null, "filled": false}}'::jsonb);
select public.import_job_save_row(:'job', 'w1', 3, format('{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9790000001026", "coverUrl": "https://covers.openlibrary.org/b/id/1-L.jpg"}, "lent": null, "filled": false}}', :'covered')::jsonb);
select public.import_job_save_row(:'job', 'w1', 4, '{"verdict": "fromFile", "tier": "needsLook", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/4-L.jpg", "write": {"book": {"title": "Never Started", "authors": ["A. Author"], "source": "manual"}, "lent": null, "filled": false}}'::jsonb);
select public.import_job_save_row(:'job', 'w1', 5, '{"verdict": "fromFile", "tier": "needsLook", "cover": "none"}');
reset role;
select is((select count(*)::int from public.import_job_rows where job_id = :'job' and write_state = 'pending'), 6, 'the match writes nothing: every row waits for its write');
select is(tests.counts(:'job'), 'running,0,0,0', 'and counts no outcome');
select is((select match_book -> 'book' ->> 'id' from public.import_job_rows where job_id = :'job' and idx = 0), :'bare', 'what the match chose to write is saved with the row');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select count(*)::int from public.import_job_take_write_rows(:'job', 'w1', 10)), 0, 'nothing is written while covers are undecided');
select is(public.import_job_release(:'job', 'w1'), 'more', 'the job is not done: rows are left to cover');
select public.import_job_claim('w1');

select public.import_job_take_cover_rows(:'job', 'w1', 5);
select public.import_job_save_cover(:'job', 'w1', 0, '{"source": "openlibrary", "url": "https://covers.openlibrary.org/b/id/22-L.jpg", "size": "L"}');
select public.import_job_save_cover(:'job', 'w1', 1, '{"source": "openlibrary", "url": "https://covers.openlibrary.org/b/id/22-L.jpg", "size": "L"}');
select public.import_job_save_cover(:'job', 'w1', 5, '{"source": "none"}');
select is((select count(*)::int from public.import_job_take_write_rows(:'job', 'w1', 10)), 6, 'with every cover decided the write phase hands every row out');
select is(public.import_job_release(:'job', 'w1'), 'more', 'handed out, not written: the job is not done');
select public.import_job_claim('w1');
select is((select count(*)::int from public.import_job_rows where job_id = :'job' and write_taken_by is not null), 0, 'the rows the runner did not reach are given back, with no attempt counted');

-- --------------------------------------------------------------- the rows

select is((select string_agg(idx || ':' || coalesce(cover_source, '-') || ':' || coalesce(cover_url, '-'), ',' order by idx)
             from public.import_job_take_write_rows(:'job', 'w1', 3)),
          '0:openlibrary:https://covers.openlibrary.org/b/id/22-L.jpg,1:openlibrary:https://covers.openlibrary.org/b/id/22-L.jpg,2:goodreads:https://i.gr-assets.com/books/1l/2.jpg',
          'the rows come in file order with the cover the job decided');
select is((select count(*)::int from public.import_job_take_write_rows(:'job', 'w1', 10)), 3, 'a row handed out is not handed out again to the same runner');

-- Written as the member, through import_books: the statuses and dates of the file.
select is(public.import_job_write(:'job', 'w1', 0, format('{"key": "goodreads:1", "book_id": "%s", "status": "finished", "ended_on": "2024-03-09", "rating": 16, "added_on": "2024-01-02", "collections": ["Favourites"]}', :'bare')::jsonb) ->> 'outcome',
          'added', 'row 0 is added to her Library');
select is(public.import_job_write(:'job', 'w1', 1, format('{"key": "goodreads:2", "book_id": "%s", "status": "want_to_read"}', :'bare')::jsonb) ->> 'outcome',
          'in_library', 'row 1 is the Book she has now: kept');
select is(public.import_job_write(:'job', 'w1', 2, '{"key": "goodreads:3", "book": {"title": "Only Goodreads Knows", "authors": ["A. Author"], "source": "manual", "cover_url": "https://i.gr-assets.com/books/1l/2.jpg"}, "status": "reading", "started_on": "2025-06-12"}'::jsonb) ->> 'outcome',
          'added', 'row 2 is her own book with its Goodreads cover');
select is(public.import_job_write(:'job', 'w1', 3, format('{"key": "goodreads:4", "book_id": "%s", "status": "want_to_read"}', :'covered')::jsonb) ->> 'outcome',
          'added', 'row 3 is added');
select is(public.import_job_write(:'job', 'w1', 4, '{"key": "goodreads:5", "book": {"title": "Never Started", "authors": ["A. Author"], "source": "manual"}, "status": "reading"}'::jsonb) ->> 'outcome',
          'failed', 'row 4 is refused by the app''s own rules: failed');
reset role;
select is(tests.row_write(:'job', 4), 'pending,failed,date_invalid', 'with the reason, recorded with the write');
select is(tests.entries(:'ada'), 3, 'three entries are hers: row 1 added none, row 4 none');
select is((select status::text from public.library_entries where member_id = :'ada' and import_key = 'goodreads:1'), 'finished', 'the status of the file');
select is((select rating::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.import_key = 'goodreads:1' and e.member_id = :'ada'), 16, 'the rating, in quarters');
select is((select count(*)::int from public.collection_entries ce join public.library_entries e on e.id = ce.entry_id where e.import_key = 'goodreads:1' and e.member_id = :'ada'), 1, 'and the shelf');
select is((select cover_url from public.books where owner_id = :'ada' and title = 'Only Goodreads Knows'), 'https://i.gr-assets.com/books/1l/2.jpg', 'her own book carries the Goodreads cover');

-- ---------------------------------------------------- idempotent per row

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_write(:'job', 'w1', 0, format('{"key": "goodreads:1", "book_id": "%s", "status": "want_to_read"}', :'bare')::jsonb) ->> 'outcome',
          'added', 'a second write of a row answers the recorded outcome');
select is(public.import_job_write(:'job', 'w1', 4, '{"key": "goodreads:5", "book": {"title": "Never Started", "authors": ["A. Author"], "source": "manual"}, "status": "want_to_read"}'::jsonb) ->> 'outcome',
          'failed', 'a failed row stays failed (its second write is not tried)');
reset role;
select is(tests.entries(:'ada'), 3, 'and writes nothing');
select is((select status::text from public.library_entries where member_id = :'ada' and import_key = 'goodreads:1'), 'finished', 'her entry is as the first write made it');

-- The covers the job found, as the member: the bare Catalogue Book gets one, a Book that has one keeps it.
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_fill_covers(:'job', 'w1', format('[{"book_id": "%s", "cover_url": "https://covers.openlibrary.org/b/id/22-L.jpg"}]', :'bare')::jsonb), 1,
          'the Catalogue Book without a cover is given the one the job found');
select is(public.import_job_fill_covers(:'job', 'w1', format('[{"book_id": "%s", "cover_url": "https://covers.openlibrary.org/b/id/22-L.jpg"}]', :'bare')::jsonb), 0,
          'a second fill changes nothing');
select is(public.import_job_fill_covers(:'job', 'w1', format('[{"book_id": "%s", "cover_url": "https://covers.openlibrary.org/b/id/99-L.jpg"}, {"book_id": "%s", "cover_url": "https://covers.openlibrary.org/b/id/99-L.jpg", "replaces": "https://covers.openlibrary.org/b/id/1-L.jpg"}]', :'bare', :'covered')::jsonb), 0,
          'a cover that is there is never overwritten: not by another cover, not by a "replaces" that is no Apple artwork');
reset role;
select is((select cover_url from public.books where id = :'bare'), 'https://covers.openlibrary.org/b/id/22-L.jpg', 'the Book keeps the first cover');
select is((select cover_url from public.books where id = :'covered'), 'https://covers.openlibrary.org/b/id/1-L.jpg', 'a Book with a cover keeps it');

-- ------------------------------------------------------ the outcomes count

set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_save_write(:'job', 'w1', 0), true, 'row 0 is written');
select is(public.import_job_save_write(:'job', 'w1', 0), true, 'a second save is a no-op');
select is(public.import_job_save_write(:'job', 'w1', 1), true, 'row 1');
select is(public.import_job_save_write(:'job', 'w1', 2), true, 'row 2');
select is(public.import_job_save_write(:'job', 'w1', 3), true, 'row 3');
select is(public.import_job_save_write(:'job', 'w1', 4), true, 'row 4');
select is(public.import_job_save_write('00000000-0000-0000-0000-000000000000', 'w1', 0), false, 'a job that is not the runner''s: told to stop');
select throws_ok(format($$ select public.import_job_save_write(%L, 'w1', 5) $$, :'job'), '22023', 'write_missing', 'a row nobody wrote cannot be marked written');
select is(public.import_job_save_write(:'job', 'w1', 5, '{"outcome": "failed", "error": "row_invalid"}'), true,
          'a row the write could not even ask about is failed with the reason');
reset role;
select is(tests.row_write(:'job', 5), 'done,failed,row_invalid', 'it is recorded');
select is(tests.counts(:'job'), 'running,3,1,2', 'the counters: 3 added (rows 0, 2, 3), 1 kept (row 1), 2 failed (rows 4, 5); each row counted once');
select is(tests.row_write(:'job', 2), 'done,added,-', 'row 2 (her own book) is written');

-- Done only when every row has its outcome; the place in the queue is given up.
select is(tests.place(:'ada'), 'job:' || :'job', 'she holds a place in the queue while the job runs');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_release(:'job', 'w1'), 'done', 'every row has its outcome: done');
reset role;
select is(tests.counts(:'job'), 'done,3,1,2', 'with its counters');
select is(tests.place(:'ada'), null, 'and the queue''s place is free for the next import');
select is((select count(*)::int from public.import_job_rows where job_id = :'job' and write_state <> 'done' or outcome is null), 0, 'no row without an outcome');

-- ------------------------------------------ a second run writes nothing

select tests.age_jobs(:'ada');
select tests.act_as(:'ada');
select public.start_import_job(tests.rows(3), 'goodreads') as again \gset
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('a1');
select public.import_job_take_rows(:'again', 'a1', 3);
select public.import_job_save_row(:'again', 'a1', 0, format('{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/22-L.jpg", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9781635575637", "coverUrl": "https://covers.openlibrary.org/b/id/22-L.jpg"}, "lent": null, "filled": false}}', :'bare')::jsonb);
select public.import_job_save_row(:'again', 'a1', 1, format('{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/22-L.jpg", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9781635575637", "coverUrl": "https://covers.openlibrary.org/b/id/22-L.jpg"}, "lent": null, "filled": false}}', :'bare')::jsonb);
select public.import_job_save_row(:'again', 'a1', 2, format('{"verdict": "matched", "tier": "quiet", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/22-L.jpg", "write": {"book": {"id": "%s", "source": "import", "isbn13": "9781635575637", "coverUrl": "https://covers.openlibrary.org/b/id/22-L.jpg"}, "lent": null, "filled": false}}', :'bare')::jsonb);
select is((select count(*)::int from public.import_job_take_write_rows(:'again', 'a1', 3)), 3, 'the same file again: its rows come to the write phase');
-- Row 0 is written, then the runner dies before saving anything.
select is(public.import_job_write(:'again', 'a1', 0, format('{"key": "goodreads:1", "book_id": "%s", "status": "finished"}', :'bare')::jsonb) ->> 'outcome',
          'imported', 'the row''s key was imported before: nothing is added');
reset role;
select tests.expire_lease(:'again');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('a2');
select is((select string_agg(idx || ':' || coalesce(outcome, '-'), ',' order by idx) from public.import_job_take_write_rows(:'again', 'a2', 3)), '0:imported,1:-,2:-',
          'the next runner resumes: the row written is handed out with its recorded outcome, no row is skipped');
select is(public.import_job_write(:'again', 'a2', 0, format('{"key": "goodreads:1", "book_id": "%s", "status": "finished"}', :'bare')::jsonb) ->> 'outcome', 'imported', 'its write answers the record');
select is(public.import_job_write(:'again', 'a2', 1, format('{"key": "goodreads:2", "book_id": "%s", "status": "finished"}', :'bare')::jsonb) ->> 'outcome', 'in_library', 'row 1: the Book is hers: kept');
select is(public.import_job_write(:'again', 'a2', 2, format('{"key": "goodreads:3", "book_id": "%s", "status": "finished"}', :'bare')::jsonb) ->> 'outcome', 'imported', 'row 2');
select public.import_job_save_write(:'again', 'a2', 0);
select public.import_job_save_write(:'again', 'a2', 1);
select is(public.import_job_release(:'again', 'a2'), 'more', 'one row is not written: not done');
select public.import_job_claim('a3');
select is((select string_agg(idx::text, ',') from public.import_job_take_write_rows(:'again', 'a3', 3)), '2', 'only that row is left to write');
select public.import_job_save_write(:'again', 'a3', 2);
select is(public.import_job_release(:'again', 'a3'), 'done', 'done');
reset role;
select is(tests.counts(:'again'), 'done,0,3,0', 'the second run added nothing: 3 kept, none added, none failed');
select is(tests.entries(:'ada'), 3, 'and her Library is as it was');

-- ------------------------------------------------ a row that kills its runners

select tests.age_jobs(:'ada');
select tests.act_as(:'ada');
select public.start_import_job(tests.rows(2), 'goodreads') as poison \gset
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('p1');
select public.import_job_take_rows(:'poison', 'p1', 2);
select public.import_job_save_row(:'poison', 'p1', 0, '{"verdict": "fromFile", "tier": "needsLook", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/4-L.jpg"}');
select public.import_job_save_row(:'poison', 'p1', 1, '{"verdict": "fromFile", "tier": "needsLook", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/4-L.jpg"}');
reset role;
-- Row 0 killed three runners; row 1's write was recorded by the last one before it died.
update public.import_job_rows set write_attempts = 3, write_taken_by = 'dead' where job_id = :'poison';
update public.import_job_rows set outcome = 'added' where job_id = :'poison' and idx = 1;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select count(*)::int from public.import_job_take_write_rows(:'poison', 'p1', 5)), 0, 'a row handed out three times is not handed out a fourth time');
reset role;
select is(tests.row_write(:'poison', 0), 'done,failed,gave_up', 'it is given up: failed, with the reason');
select is(tests.row_write(:'poison', 1), 'done,added,-', 'a row whose write was recorded keeps what it came to');
select is(tests.counts(:'poison'), 'running,1,0,1', 'and each is counted as what it came to');
set local role service_role;
select is(public.import_job_release(:'poison', 'p1'), 'done', 'the job does not wait for it');
reset role;

-- ------------------------------------------- cancelled or failed: the place is free

select tests.age_jobs(:'ada');
select tests.act_as(:'ada');
select public.start_import_job(tests.rows(1), 'goodreads') as gone \gset
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('g1');
select public.import_job_take_rows(:'gone', 'g1', 1);
select public.import_job_save_row(:'gone', 'g1', 0, '{"verdict": "fromFile", "tier": "needsLook", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/4-L.jpg"}');
reset role;
select is(tests.place(:'ada'), 'job:' || :'gone', 'a job in its write phase holds the place');
select tests.act_as(:'ada');
select is(public.cancel_import_job(:'gone'), true, 'she cancels it');
reset role;
select is(tests.place(:'ada'), null, 'the place is free');
set local role service_role;
select is((select count(*)::int from public.import_job_take_write_rows(:'gone', 'g1', 5)), 0, 'a cancelled job hands out nothing');
select is(public.import_job_save_write(:'gone', 'g1', 0), false, 'and its runner is told to stop');
reset role;
