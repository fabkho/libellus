-- "Import done" as a Web Push (supabase test db): a member saves and drops her browser's subscription (own rows only, through
-- two functions), the sender (service role) claims a job's push once, the database kicks the `import-job` function when a job
-- turns done or failed. See 20261106010000_push_subscriptions.sql.

begin;
select plan(39);

create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-PUSH', 'push test', 10);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
          jsonb_build_object('invite_code', 'T-PUSH'), now(), now(), now());
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
create or replace function tests.as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;
-- A subscription's keys, as a browser makes them: base64url, 87 and 22 characters.
create or replace function tests.p256dh(p_seed text) returns text language sql as $$ select left(repeat(p_seed, 87), 87) $$;
create or replace function tests.auth(p_seed text) returns text language sql as $$ select left(repeat(p_seed, 22), 22) $$;
-- A job the way the database leaves it: a member's, in a state, with the counts it came to.
create or replace function tests.job(p_member uuid, p_state text) returns uuid language plpgsql security definer as $$
declare v_job uuid := gen_random_uuid();
begin
  insert into public.import_jobs (id, member_id, source, total, state, added, kept, failed, already, finished_at)
  values (v_job, p_member, 'goodreads', 10, p_state, case when p_state = 'queued' then 0 else 7 end, case when p_state = 'queued' then 0 else 2 end,
          case when p_state = 'queued' then 0 else 1 end, case when p_state = 'queued' then 0 else 3 end,
          case when p_state in ('done', 'failed') then now() end);
  return v_job;
end;
$$;
grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ada@push.pgtap.test') as ada \gset
select tests.member('bo@push.pgtap.test') as bo \gset

-- ------------------------------------------------------------ her own rows

select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'RLS is on');
select ok(not has_table_privilege('anon', 'public.push_subscriptions', 'select'), 'a visitor reads no subscription');
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text)', 'execute'), 'nor saves one');

select tests.act_as(:'ada');
select lives_ok(format($$ select public.save_push_subscription('https://push.example.test/ada-phone', %L, %L, 'de') $$, tests.p256dh('A'), tests.auth('a')),
  'she saves her phone');
select is((select count(*)::int from public.push_subscriptions), 1, 'she reads her own subscription');
select is((select locale from public.push_subscriptions), 'de', 'with the language she was in');
select throws_ok(format($$ insert into public.push_subscriptions (member_id, endpoint, p256dh, auth) values (%L, 'https://push.example.test/x', %L, %L) $$, :'ada', tests.p256dh('A'), tests.auth('a')),
  '42501', null, 'she writes the table only through the function');
select throws_ok($$ update public.push_subscriptions set locale = 'en' $$, '42501', null, 'never updates it');
select throws_ok($$ delete from public.push_subscriptions $$, '42501', null, 'nor deletes from it');

select lives_ok(format($$ select public.save_push_subscription('https://push.example.test/ada-phone', %L, %L, 'en') $$, tests.p256dh('B'), tests.auth('b')),
  'saving the same browser again');
select is((select count(*)::int from public.push_subscriptions), 1, 'is the same row');
select is((select left(p256dh, 1) || '/' || locale from public.push_subscriptions), 'B/en', 'with the new keys and language');

select throws_ok($$ select public.save_push_subscription('http://push.example.test/plain', 'x', 'y') $$, '23514', null, 'an address that is not https is refused');
select throws_ok(format($$ select public.save_push_subscription('https://push.example.test/short', 'short', %L) $$, tests.auth('a')), '23514', null, 'so are keys that are not a browser''s');
reset role;

select tests.act_as(:'bo');
select is((select count(*)::int from public.push_subscriptions), 0, 'another member reads nothing of it');
select is(public.delete_push_subscription('https://push.example.test/ada-phone'), false, 'and drops nothing of it');
-- Signed in on ada's browser after her: the browser's subscription is bo's now.
select public.save_push_subscription('https://push.example.test/ada-phone', tests.p256dh('C'), tests.auth('c'), 'en');
select is((select count(*)::int from public.push_subscriptions), 1, 'a browser two members used belongs to the one who agreed last');
reset role;
select tests.act_as(:'ada');
select is((select count(*)::int from public.push_subscriptions), 0, 'and not to the first any more');
reset role;

select tests.act_as(:'bo');
select is(public.delete_push_subscription('https://push.example.test/ada-phone'), true, 'she drops her own subscription');
select is(public.delete_push_subscription('https://push.example.test/ada-phone'), false, 'a second time there is none');
select public.save_push_subscription('https://push.example.test/bo-' || i, tests.p256dh('D'), tests.auth('d')) from generate_series(1, 12) i;
select is((select count(*)::int from public.push_subscriptions), 10, 'at most ten browsers a member: the oldest go');
reset role;

-- ------------------------------------------------------------ one push a job

select tests.job(:'ada', 'running') as live \gset
select tests.job(:'ada', 'cancelled') as cancelled \gset
select tests.job(:'ada', 'done') as done \gset
select tests.job(:'bo', 'failed') as failed \gset

select tests.act_as(:'ada');
select throws_ok(format($$ select public.import_job_claim_push(%L) $$, :'done'), '42501', null, 'a member claims no push');
reset role;

select tests.as_service();
select is(public.import_job_claim_push(:'live'), null, 'a job still running has no push');
select is(public.import_job_claim_push(:'cancelled'), null, 'nor a cancelled one');
select is(public.import_job_claim_push(:'done') - 'member_id', '{"state": "done", "added": 7, "kept": 5, "failed": 1}'::jsonb,
  'a done job''s push: what it added, what was there already (kept and the rows the device left out), what failed');
select is(public.import_job_claim_push(:'done'), null, 'is claimed once');
select isnt((select notified_at from public.import_jobs where id = :'done'), null, 'the job says so');
select lives_ok(format($$ select public.import_job_unclaim_push(%L) $$, :'done'), 'a claim is given back when nobody could be reached');
select is((public.import_job_claim_push(:'done'))->>'state', 'done', 'and the next kick claims it again');
select is((public.import_job_claim_push(:'failed'))->>'state', 'failed', 'a failed job has its push too');
reset role;

-- ------------------------------------------------------------ the kick

select is(private.import_push_kick(:'failed'), 'off', 'with no function address nothing is sent (the local stack, CI)');
update private.import_job_settings set function_url = 'https://abc.supabase.co/functions/v1/import-job';
delete from vault.secrets where name = 'import_job_token';
select is(private.import_push_kick(:'failed'), 'unavailable', 'with no secret in the Vault nothing is sent');
select vault.create_secret(repeat('s', 40), 'import_job_token');
select is(private.import_push_kick(:'failed'), 'sent', 'with both, the call goes to the function');
select tests.member('cy@push.pgtap.test') as cy \gset
select tests.job(:'cy', 'done') as quiet \gset
select is(private.import_push_kick(:'quiet'), 'idle', 'a member with no browser to tell is not called for');

-- The trigger: a job turning done or failed kicks the function once; a live or cancelled one does not.
delete from net.http_request_queue;
select tests.job(:'bo', 'queued') as next \gset
update public.import_jobs set state = 'running' where id = :'next';
select is((select count(*)::int from net.http_request_queue), 0, 'a job that starts kicks no push');
update public.import_jobs set state = 'done', finished_at = now() where id = :'next';
select is((select count(*)::int from net.http_request_queue where convert_from(body, 'utf8')::jsonb @> jsonb_build_object('action', 'notify', 'job', :'next')), 1,
  'a job that is done does, with its id');
update public.import_jobs set state = 'cancelled' where id = :'next';
select is((select count(*)::int from net.http_request_queue), 1, 'and nothing else is sent');

-- The safety net: a job that ended a minute ago and was not claimed is kicked again; a claimed one, or an old one, is not.
update public.import_jobs set state = 'done', notified_at = null, finished_at = now() - interval '2 minutes' where id = :'next';
select is(private.import_push_sweep(), 1, 'the sweep kicks the job whose push is still due');
update public.import_jobs set notified_at = now() where id = :'next';
select is(private.import_push_sweep(), 0, 'not the one that was claimed');

select * from finish();
rollback;
