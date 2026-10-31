-- The Hardcover zip's lists reach the import job (supabase test db; docs/plans/hardcover-zip.md, PR 2;
-- 20261111010000_import_zip_job.sql): `start_import_job` keeps her ranked lists (in rank order) and her empty ones with the job, the
-- job's FIRST write makes her empty Collections, and its end step (when the job is done) puts each ranked Collection in order
-- through `reorder_collection`, her older entries first. A job without lists (a CSV, or one queued before the migration) is as
-- it was; a list or an order only ever touches the importing member's own rows. The runner's side (what the write sends) is Deno
-- (supabase/functions/import-job/write_test.ts); the row's `progress` is import_books_progress_test.sql.

begin;
select plan(63);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-ZIPJOB', 'import job zip test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-ZIPJOB'), now(), now(), now());
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
-- n rows, keys goodreads:1 … goodreads:n, each on the Collection `p_collection` when one is named.
create or replace function tests.rows(p_n integer, p_collection text default null)
returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('key', 'goodreads:' || i, 'title', 'Book ' || i, 'authors', jsonb_build_array('A. Author'),
                                      'collections', case when p_collection is null then '[]'::jsonb else jsonb_build_array(p_collection) end))
    from generate_series(1, p_n) i
$$;
create or replace function tests.age_jobs(p_member uuid)
returns void language sql security definer as $$
  update public.import_jobs set created_at = created_at - interval '1 hour' where member_id = p_member
$$;
-- Her Collection's entries, first to last, as their import keys.
create or replace function tests.order_of(p_member uuid, p_name text)
returns text language sql security definer as $$
  select coalesce(string_agg(e.import_key, ',' order by ce.position), '-')
    from public.collections c
    join public.collection_entries ce on ce.collection_id = c.id
    join public.library_entries e on e.id = ce.entry_id
   where c.member_id = p_member and c.name = p_name
$$;
create or replace function tests.collections(p_member uuid)
returns text language sql security definer as $$
  select coalesce(string_agg(name, ',' order by position), '-') from public.collections where member_id = p_member
$$;
create or replace function tests.lists(p_job uuid)
returns text language sql security definer as $$
  select coalesce((select jsonb_array_length(collection_order)::text || '/' || jsonb_array_length(empty_collections)::text || '/' || empty_made::text
                     from public.import_job_collections where job_id = p_job), 'none')
$$;
-- A job that ran to its write phase: claims, matches and covers every row with a file-own Book (`manual`).
create or replace function tests.to_write_phase(p_job uuid, p_runner text, p_n integer)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  perform public.import_job_claim(p_runner);
  perform public.import_job_take_rows(p_job, p_runner, p_n);
  for i in 0 .. p_n - 1 loop
    perform public.import_job_save_row(p_job, p_runner, i, format(
      '{"verdict": "fromFile", "tier": "needsLook", "cover": "own", "cover_url": "https://covers.openlibrary.org/b/id/4-L.jpg", "write": {"book": {"title": "Book %s", "authors": ["A. Author"], "source": "manual"}, "lent": null, "filled": false}}', i + 1)::jsonb);
  end loop;
  perform public.import_job_take_write_rows(p_job, p_runner, p_n);
  execute 'reset role';
end;
$$;
-- One row written the way the runner writes it, then saved.
create or replace function tests.write_row(p_job uuid, p_runner text, p_idx integer)
returns text language plpgsql as $$
declare v_outcome text;
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  execute 'set local role service_role';
  v_outcome := public.import_job_write(p_job, p_runner, p_idx, (
    select jsonb_build_object('key', r.key, 'book', jsonb_build_object('title', r.payload ->> 'title', 'authors', r.payload -> 'authors', 'source', 'manual'),
                              'status', 'want_to_read', 'collections', r.payload -> 'collections')
      from public.import_job_rows r where r.job_id = p_job and r.idx = p_idx)) ->> 'outcome';
  perform public.import_job_save_write(p_job, p_runner, p_idx);
  execute 'reset role';
  return v_outcome;
end;
$$;
create or replace function tests.expire_lease(p_job uuid)
returns void language sql security definer as $$
  update public.import_jobs set lease_until = now() - interval '1 second' where id = p_job
$$;
create or replace function tests.fail_reorder()
returns trigger language plpgsql as $$
begin
  raise exception 'order_mismatch' using errcode = '22023';
end;
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@zipjob.pgtap.test') as ada \gset
select tests.member('bo@zipjob.pgtap.test') as bo \gset
select tests.member('cy@zipjob.pgtap.test') as cy \gset
select tests.member('di@zipjob.pgtap.test') as di \gset
select tests.member('ed@zipjob.pgtap.test') as ed \gset
select tests.member('fy@zipjob.pgtap.test') as fy \gset

-- --------------------------------------------------------------- the shape

select ok(not has_table_privilege('authenticated', 'public.import_job_collections', 'select')
          and not has_table_privilege('anon', 'public.import_job_collections', 'select')
          and not has_table_privilege('authenticated', 'public.import_job_collections', 'insert')
          and (select relrowsecurity from pg_class where oid = 'public.import_job_collections'::regclass),
          'no member reads or writes a job''s lists: RLS on, no grant to members');
select ok(not has_function_privilege('authenticated', 'private.import_job_finish(uuid, text)', 'execute')
          and not has_function_privilege('service_role', 'private.import_job_finish(uuid, text)', 'execute')
          and not has_function_privilege('authenticated', 'private.import_job_make_empty_collections(uuid)', 'execute'),
          'the end step and the empty Collections are for the job''s own functions only');
select ok(has_function_privilege('authenticated', 'public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.start_import_job(jsonb, text, text, integer, text[], jsonb, jsonb)', 'execute')
          and (select count(*) from pg_proc where proname = 'start_import_job') = 1,
          'one start_import_job: members only; the five-argument call is this one');

-- ------------------------------------------------------------- the start

-- bo has a Collection of the same name, with entries: nothing of ada's job may touch it.
select tests.act_as(:'bo');
select public.import_books('[{"key": "goodreads:81", "book": {"title": "Bo One", "authors": ["B. Author"], "source": "manual"}, "collections": ["Ranked"]},
                             {"key": "goodreads:82", "book": {"title": "Bo Two", "authors": ["B. Author"], "source": "manual"}, "collections": ["Ranked"]}]');
reset role;
select is(tests.order_of(:'bo', 'Ranked'), 'goodreads:81,goodreads:82', 'bo has a Collection of the same name');

-- ada has two older entries on "Ranked" (added before the job), which stay at the front.
select tests.act_as(:'ada');
select public.import_books('[{"key": "goodreads:91", "book": {"title": "Old One", "authors": ["A. Author"], "source": "manual"}, "collections": ["Ranked"]},
                             {"key": "goodreads:92", "book": {"title": "Old Two", "authors": ["A. Author"], "source": "manual"}, "collections": ["Ranked"]}]');
reset role;
update public.collection_entries set added_at = now() - interval '1 day'
 where collection_id in (select id from public.collections where member_id = :'ada');
select is(tests.order_of(:'ada', 'Ranked'), 'goodreads:91,goodreads:92', 'ada has two older entries on Ranked');

select tests.act_as(:'ada');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '{"name": "x"}'::jsonb) $$, '22023', 'collections_invalid', 'an order that is no array is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "  ", "keys": []}]'::jsonb) $$, '22023', 'collections_invalid', 'a list without a name is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "A", "keys": "goodreads:1"}]'::jsonb) $$, '22023', 'collections_invalid', 'keys that are no array are refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "A", "keys": [1]}]'::jsonb) $$, '22023', 'collections_invalid', 'a key that is no string is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "A"}]'::jsonb) $$, '22023', 'collections_invalid', 'a list without keys is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}',
                       (select jsonb_agg(jsonb_build_object('name', 'L' || i, 'keys', '[]'::jsonb)) from generate_series(1, 501) i)) $$,
                 '22023', 'collections_invalid', 'over 500 lists is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}',
                       jsonb_build_array(jsonb_build_object('name', 'A', 'keys', (select jsonb_agg('k' || i) from generate_series(1, 10001) i)))) $$,
                 '22023', 'collections_invalid', 'over 10,000 keys a list is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', null, '{"a": 1}'::jsonb) $$, '22023', 'collections_invalid', 'empty lists that are no array are refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', null, '[1]'::jsonb) $$, '22023', 'collections_invalid', 'an empty list that is no name is refused');
select throws_ok($$ select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', null, (select jsonb_agg('e' || i) from generate_series(1, 501) i)) $$,
                 '22023', 'collections_invalid', 'over 500 empty lists is refused');
reset role;
select is((select count(*)::int from public.import_jobs where member_id = :'ada'), 0, 'a refused start leaves no job');

-- The job: four rows (1, 3, 4 on Ranked; 2 on Other), her ranked list in an order of its own, two empty lists (one she has: any case).
select tests.act_as(:'ada');
select public.start_import_job(
  (select jsonb_agg(case when (r ->> 'key') = 'goodreads:2' then jsonb_set(r, '{collections}', '["Other"]') else r end order by (r ->> 'key'))
     from jsonb_array_elements(tests.rows(4, 'Ranked')) r),
  'hardcover', null, 0, '{}',
  '[{"name": "Ranked", "keys": ["goodreads:3", "goodreads:1", "goodreads:99", "goodreads:91", "goodreads:4", "goodreads:81"]},
    {"name": "Gone", "keys": ["goodreads:2"]}]'::jsonb,
  '["Empty One", "ranked", "  ", "Empty Two"]'::jsonb) as job \gset
reset role;
select is(tests.lists(:'job'), '2/4/false', 'the job keeps its lists, none of the empty ones made yet');
select is(tests.collections(:'ada'), 'Ranked', 'nothing is made at the start');

select tests.to_write_phase(:'job', 'w1', 4);
select is(tests.collections(:'ada'), 'Ranked', 'nor while rows are matched and covered');

-- The first write makes the empty Collections (the one she has stays as it is).
select is(tests.write_row(:'job', 'w1', 0), 'added', 'the first write: row 1');
select is(tests.collections(:'ada'), 'Ranked,Empty One,Empty Two', 'it made her empty Collections, not the one she has, not a blank name');
select is(tests.lists(:'job'), '2/4/true', 'once');
select is(tests.write_row(:'job', 'w1', 1), 'added', 'row 2');
select is(tests.write_row(:'job', 'w1', 2), 'added', 'row 3');
select is(tests.collections(:'ada'), 'Ranked,Empty One,Empty Two,Other', 'later writes make no empty Collection again; the rows'' own lists come as always');
select is(tests.order_of(:'ada', 'Ranked'), 'goodreads:91,goodreads:92,goodreads:1,goodreads:3', 'the order is write order until the end step');
select is(tests.write_row(:'job', 'w1', 3), 'added', 'row 4');

-- The end step: when the job is done, ranked Collections are in order, her older entries first.
select is(public.import_job_release(:'job', 'w1'), 'done', 'every row is written: done');
select is(tests.order_of(:'ada', 'Ranked'), 'goodreads:91,goodreads:92,goodreads:3,goodreads:1,goodreads:4',
          'her older entries keep the front, this import''s follow in rank order (a key without an entry, another member''s key, and an older entry named in the list are passed over)');
select is(tests.order_of(:'ada', 'Other'), 'goodreads:2', 'a list that is not ranked is as it was written');
select is(tests.order_of(:'bo', 'Ranked'), 'goodreads:81,goodreads:82', 'another member''s Collection of the same name is untouched');
select is((select count(*)::int from public.collection_entries ce join public.collections c on c.id = ce.collection_id where c.member_id = :'bo'), 2,
          'and nothing of ada''s was put on it');
select is(tests.lists(:'job'), 'none', 'the lists are gone with the done job');
select is((select state from public.import_jobs where id = :'job'), 'done', 'the job is done');

-- A job without lists (a CSV; a job queued before this migration has no row for them either) is as it was.
select tests.age_jobs(:'bo');
select tests.act_as(:'bo');
select public.start_import_job(tests.rows(2, 'Ranked'), 'goodreads') as plain \gset
reset role;
select is(tests.lists(:'plain'), 'none', 'a job started without lists keeps none');
select tests.to_write_phase(:'plain', 'p1', 2);
select is(tests.write_row(:'plain', 'p1', 0), 'added', 'its first write');
select is(tests.write_row(:'plain', 'p1', 1), 'added', 'and second');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_release(:'plain', 'p1'), 'done', 'done, with no end step to run');
reset role;
select is(tests.order_of(:'bo', 'Ranked'), 'goodreads:81,goodreads:82,goodreads:1,goodreads:2', 'her Collections are as written');

-- Cancel: the lists go with the rows. Retry: they go to the new job.
select tests.act_as(:'di');
select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "A", "keys": ["goodreads:1"]}]'::jsonb, '["E"]'::jsonb) as cancelled \gset
select is(tests.lists(:'cancelled'), '1/1/false', 'a job with lists');
select is(public.cancel_import_job(:'cancelled'), true, 'she cancels it');
reset role;
select is(tests.lists(:'cancelled'), 'none', 'its lists are deleted with its rows');

select tests.act_as(:'cy');
select public.start_import_job(tests.rows(2), 'hardcover', null, 0, '{}', '[{"name": "A", "keys": ["goodreads:1"]}]'::jsonb, '["E"]'::jsonb) as failed \gset
reset role;
update public.import_jobs set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null where id = :'failed';
select private.import_job_dequeue(:'failed');
select tests.age_jobs(:'cy');
select tests.act_as(:'cy');
select public.retry_import_job(:'failed') as again \gset
reset role;
select is(tests.lists(:'again'), '1/1/false', 'a retried job takes its lists over');

-- Thirty days after a job ended its lists are deleted as its rows are.
update public.import_jobs set finished_at = now() - interval '31 days' where id = :'failed';
select private.import_job_tick();
select is(tests.lists(:'failed'), 'none', 'the tick deletes the lists of a job that ended 30 days ago');
select is(tests.lists(:'again'), '1/1/false', 'and not a live job''s');
-- cy's retried job is live and holds the queue: it leaves, the next jobs of this test run.
select tests.act_as(:'cy');
select public.cancel_import_job(:'again');
reset role;

-- ------------------------------------------- a retried job keeps the ranking of the books its failed predecessor wrote

-- ed has an older entry on Ranked. Job 1 (four rows; ranked 4, 2, 3, 1; one empty list) writes rows 1 and 2, its runner dies and
-- another resumes it (the empty Collection is made once), then it fails; the retry writes rows 3 and 4.
select tests.act_as(:'ed');
select public.import_books('[{"key": "goodreads:95", "book": {"title": "Old Five", "authors": ["A. Author"], "source": "manual"}, "collections": ["Ranked"]}]');
reset role;
update public.collection_entries set added_at = now() - interval '1 day'
 where collection_id in (select id from public.collections where member_id = :'ed');
select tests.act_as(:'ed');
select public.start_import_job(tests.rows(4, 'Ranked'), 'hardcover', null, 0, '{}',
  '[{"name": "Ranked", "keys": ["goodreads:4", "goodreads:2", "goodreads:3", "goodreads:1"]}]'::jsonb, '["Empty One"]'::jsonb) as first \gset
reset role;
select tests.to_write_phase(:'first', 'e1', 4);
select is(tests.write_row(:'first', 'e1', 0), 'added', 'job 1 writes row 1');
select tests.expire_lease(:'first');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select public.import_job_claim('e1b');
select public.import_job_take_write_rows(:'first', 'e1b', 4);
reset role;
select is(tests.write_row(:'first', 'e1b', 1), 'added', 'a second runner resumes it: row 2');
select is(tests.collections(:'ed'), 'Ranked,Empty One', 'the empty Collection is made once, by the first write, not again by the resumed job');
update public.import_jobs set state = 'failed', error = 'stalled', finished_at = now(), runner = null, lease_until = null where id = :'first';
select private.import_job_dequeue(:'first');
select tests.age_jobs(:'ed');
select tests.act_as(:'ed');
select public.retry_import_job(:'first') as second \gset
reset role;
select is(tests.lists(:'second'), '1/1/false', 'the retry takes the lists over (its own first write has not made the empty one yet)');
select is((select b.began_at = a.began_at from public.import_job_collections a, public.import_job_collections b where a.job_id = :'first' and b.job_id = :'second'), true,
          'and the time the import began, so the books job 1 wrote are this import''s too');
select tests.to_write_phase(:'second', 'e2', 2);
select is(tests.write_row(:'second', 'e2', 0), 'added', 'the retry writes row 3');
select is(tests.write_row(:'second', 'e2', 1), 'added', 'and row 4');
select is(tests.collections(:'ed'), 'Ranked,Empty One', 'its first write does not make the empty Collection a second time');
select is(tests.order_of(:'ed', 'Ranked'), 'goodreads:95,goodreads:1,goodreads:2,goodreads:3,goodreads:4', 'write order until the end step');
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_release(:'second', 'e2'), 'done', 'the retry is done');
reset role;
select is(tests.order_of(:'ed', 'Ranked'), 'goodreads:95,goodreads:4,goodreads:2,goodreads:3,goodreads:1',
          'the ranking covers the books job 1 wrote too (found by their import key); her older entry keeps the front');

-- ------------------------------------------- an end step that fails does not fail the job

select tests.act_as(:'fy');
select public.start_import_job(tests.rows(3, 'Ranked'), 'hardcover', null, 0, '{}',
  '[{"name": "Ranked", "keys": ["goodreads:3", "goodreads:2", "goodreads:1"]}]'::jsonb, '["Empty Late"]'::jsonb) as flaky \gset
reset role;
select tests.to_write_phase(:'flaky', 'f1', 3);
select is(tests.write_row(:'flaky', 'f1', 0), 'added', 'a job whose reorder will fail: row 1');
select is(tests.write_row(:'flaky', 'f1', 1), 'added', 'row 2');
select is(tests.write_row(:'flaky', 'f1', 2), 'added', 'row 3');
create trigger tests_fail_reorder before update on public.collection_entries for each row execute function tests.fail_reorder();
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is(public.import_job_release(:'flaky', 'f1'), 'done', 'reorder_collection fails (order_mismatch): the job is done all the same');
reset role;
drop trigger tests_fail_reorder on public.collection_entries;
select is(tests.order_of(:'fy', 'Ranked'), 'goodreads:1,goodreads:2,goodreads:3', 'her Collection is as written (the failed reorder left nothing half done)');
select is(tests.lists(:'flaky'), 'none', 'and its lists are gone');
select is((select state from public.import_jobs where id = :'flaky'), 'done', 'state done');

select * from finish();
rollback;
