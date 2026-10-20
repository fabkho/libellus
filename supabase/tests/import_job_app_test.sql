-- The app follows its import job (supabase test db): she reads her own job and rows (what Realtime and the app's reads
-- are allowed by: RLS select-own), the job table is in the Realtime publication, and a failed job is retried from its own
-- rows (retry_import_job). See 20261102010000_import_jobs.sql, 20261105010000_import_job_retry.sql.

begin;
select plan(15);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-JOBAPP', 'import job app test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-JOBAPP'), now(), now(), now());
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
  select jsonb_agg(jsonb_build_object('key', 'goodreads:' || i, 'title', 'Book ' || i, 'authors', jsonb_build_array('A. Author'), 'collections', jsonb_build_array('favourites')))
    from generate_series(1, p_n) i
$$;
-- A job as the runner leaves it: ended, some rows written, one failed, the rest untouched.
create or replace function tests.fail_job(p_job uuid)
returns void language plpgsql security definer as $$
begin
  update public.import_job_rows set state = 'done', outcome = 'added' where job_id = p_job and idx in (0, 1);
  update public.import_job_rows set state = 'done', outcome = 'failed', error = 'row_invalid' where job_id = p_job and idx = 2;
  update public.import_jobs set state = 'failed', error = 'stalled', finished_at = now(), created_at = created_at - interval '1 hour' where id = p_job;
  perform private.import_job_dequeue(p_job);
end;
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@jobapp.pgtap.test') as ada \gset
select tests.member('bo@jobapp.pgtap.test') as bo \gset

-- ------------------------------------------------------------ Realtime and RLS

select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'import_jobs'),
          'import_jobs is in the Realtime publication');
select ok((select relrowsecurity from pg_class where oid = 'public.import_jobs'::regclass), 'RLS is on, so Realtime shows a member only her own job');
select ok(not has_table_privilege('anon', 'public.import_jobs', 'select'), 'a visitor reads no job');

select tests.act_as(:'ada');
select public.start_import_job(tests.rows(5), 'goodreads', 'dev-phone', 1, array['en']) as job \gset
select is((select count(*)::int from public.import_jobs), 1, 'she reads her own job');
select is((select count(*)::int from public.import_job_rows), 5, 'and its rows (the app reads the entries the job added from them)');
reset role;
select tests.act_as(:'bo');
select is((select count(*)::int from public.import_jobs), 0, 'another member reads nothing of it');
select is((select count(*)::int from public.import_job_rows), 0, 'nor of its rows');
select throws_ok(format($$ select public.retry_import_job(%L) $$, :'job'), 'P0002', 'job_unknown', 'nor retries it');
reset role;

-- ---------------------------------------------------------------- retry

select tests.act_as(:'ada');
select throws_ok(format($$ select public.retry_import_job(%L) $$, :'job'), '55000', 'job_not_failed', 'a job that is not failed is not retried');
reset role;
select tests.fail_job(:'job');
select tests.act_as(:'ada');
select public.retry_import_job(:'job') as again \gset
select isnt(:'again'::text, :'job'::text, 'the retry is a new job');
select is((select row(total, already, source, device, languages)::text from public.import_jobs where id = :'again'), '(3,3,goodreads,dev-phone,{en})',
          'it takes the rows without an outcome and the failed one, counts the written two as already there, keeps the source and the device');
select is((select string_agg(key, ',' order by idx) from public.import_job_rows where job_id = :'again'), 'goodreads:3,goodreads:4,goodreads:5',
          'its rows are the failed job''s, as uploaded');
select is((select payload -> 'collections' ->> 0 from public.import_job_rows where job_id = :'again' and idx = 0), 'favourites', 'with their Collections');
select throws_ok(format($$ select public.retry_import_job(%L) $$, :'job'), '55000', 'import_running', 'one live job at a time: a second retry is refused');
reset role;
-- Visitors cannot call it.
select ok(not has_function_privilege('anon', 'public.retry_import_job(uuid)', 'execute') and has_function_privilege('authenticated', 'public.retry_import_job(uuid)', 'execute'),
          'members retry, visitors do not');

select * from finish();
rollback;
