-- The client error log:
--   supabase test db
--
-- `log_client_error` is the only way into `private.client_errors`. A member's
-- report is hers (user_id), a signed-out one is nobody's and keyed by a salted
-- hash of the address, never the address. What is stored is scrubbed (no e-mail
-- addresses, no query or fragment of a URL, the route's path only) and cut to
-- size. The same error again within ten minutes is counted on its row; a caller
-- adds at most 30 rows an hour (10 per signed-out address, 100 for all
-- signed-out callers together) and the rest is dropped quietly. Members and
-- signed-out callers can neither read nor delete the rows; an account's rows go
-- with it; rows older than 30 days are swept daily. Assertions ask about the rows
-- this test made, never about how many rows the table holds.

begin;
select plan(49);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-ERRLOG', 'client error log test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-ERRLOG"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  perform set_config('request.headers', '{}', true);
  execute 'set local role authenticated';
end;
$$;

-- Signed out, from an address (as PostgREST passes the request's headers on).
create or replace function tests.act_anon(p_address text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', json_build_object('x-forwarded-for', p_address || ', 10.0.0.1')::text, true);
  execute 'set local role anon';
end;
$$;

-- Read and move this test's rows, as the owner (the roles above cannot).
create or replace function tests.errors_of(p_user uuid, p_message text)
returns setof private.client_errors language sql security definer as $$
  select * from private.client_errors where user_id is not distinct from p_user and message = p_message order by id
$$;
create or replace function tests.age(p_message_like text, p_by interval)
returns void language sql security definer as $$
  update private.client_errors set created_at = created_at - p_by, last_seen_at = last_seen_at - p_by
   where message like p_message_like
$$;
grant execute on all functions in schema tests to public;
grant usage on schema tests to public;

create temp table ids on commit drop as
  select tests.member('errlog-a@libellus.test') as ada, tests.member('errlog-b@libellus.test') as bo;
grant select on ids to public;

-- -------------------------------------------------------------- a member's report

select tests.act_as((select ada from ids));

select is(public.log_client_error('error', 'T-ERRLOG boom', 'at f (https://app.test/_nuxt/a.js:1:2)', '/library',
                                  'build-1', 'iOS 18.2 Safari', true, true),
          'logged', 'a member reports an error');
select is(public.log_client_error('error', 'T-ERRLOG boom', 'at f (https://app.test/_nuxt/a.js:1:2)', '/library',
                                  'build-1', 'iOS 18.2 Safari', true, true),
          'counted', 'the same error again within ten minutes is counted');
select is(public.log_client_error('error', 'T-ERRLOG boom', 'at f (https://app.test/_nuxt/a.js:1:2)', p_count => 5),
          'counted', 'a report the device already coalesced counts as many');
select is(public.log_client_error('error', 'T-ERRLOG boom', 'at g (https://app.test/_nuxt/b.js:3:4)'),
          'logged', 'the same message with another stack is a row of its own');
select is(public.log_client_error('vue', 'T-ERRLOG boom', 'at f (https://app.test/_nuxt/a.js:1:2)'),
          'logged', 'and so is the same error of another kind');

select is(public.log_client_error('outbox', 'T-ERRLOG start_reading refused: not_reading'), 'logged',
          'a report without a stack, route or device details is taken');

select throws_ok($$select public.log_client_error('nonsense', 'T-ERRLOG x')$$, '22023', 'kind_invalid',
                 'an unknown kind is refused');
select throws_ok($$select public.log_client_error('error', '   ')$$, '22023', 'message_missing',
                 'a blank message is refused');
select throws_ok($$select public.log_client_error('error', null)$$, '22023', 'message_missing',
                 'and so is none');

-- What members cannot do.
select throws_ok($$select count(*) from private.client_errors$$, '42501', null, 'a member cannot read the log');
select throws_ok($$delete from private.client_errors$$, '42501', null, 'a member cannot delete from it');
select throws_ok($$update private.client_errors set count = 1$$, '42501', null, 'nor change it');
select throws_ok($$select private.purge_client_errors()$$, '42501', null, 'nor run the sweep');

reset role;

select is((select count(*)::int from tests.errors_of((select ada from ids), 'T-ERRLOG boom') where kind = 'error' and stack like '%a.js%'),
          1, 'the repeats made no rows of their own');
select is((select count from tests.errors_of((select ada from ids), 'T-ERRLOG boom') where kind = 'error' and stack like '%a.js%'),
          7, 'they counted on the first: once, again, and five more');
select is((select row(kind, route, app_version, user_agent, standalone, online)::text
             from tests.errors_of((select ada from ids), 'T-ERRLOG boom') where kind = 'error' and stack like '%a.js%'),
          row('error', '/library', 'build-1', 'iOS 18.2 Safari', true, true)::text,
          'the row keeps what the device said about itself');
select is((select caller_key from tests.errors_of((select ada from ids), 'T-ERRLOG boom') limit 1),
          'member:' || (select ada from ids), 'and counts against the member');

-- The ten minutes run from the row's first report.
select tests.age('T-ERRLOG boom', interval '11 minutes');
select tests.act_as((select ada from ids));
select is(public.log_client_error('error', 'T-ERRLOG boom', 'at f (https://app.test/_nuxt/a.js:1:2)'),
          'logged', 'the same error after ten minutes is a new row');
reset role;
select is((select count(*)::int from tests.errors_of((select ada from ids), 'T-ERRLOG boom') where kind = 'error' and stack like '%a.js%'),
          2, 'beside the old one');

-- ------------------------------------------------------- scrubbed and cut to size

select tests.act_as((select ada from ids));
select is(public.log_client_error('error',
            'T-ERRLOG scrub: GET https://api.test/rest/v1/books?title=ilike.*Dune*&select=id#top failed for ada@example.com',
            'at load (https://app.test/_nuxt/x.js?v=1a2b3c:10:4)' || chr(10) || 'at https://app.test/share?title=Dune&text=a+b y',
            '/share?title=Dune&text=hello#frag', null, null, null, null),
          'logged', 'a report with personal details in it is taken');
reset role;
select is((select message from tests.errors_of((select ada from ids), 'T-ERRLOG scrub: GET https://api.test/rest/v1/books failed for [email]')),
          'T-ERRLOG scrub: GET https://api.test/rest/v1/books failed for [email]',
          'the message keeps no query, fragment or e-mail address');
select is((select stack from tests.errors_of((select ada from ids), 'T-ERRLOG scrub: GET https://api.test/rest/v1/books failed for [email]')),
          'at load (https://app.test/_nuxt/x.js:10:4)' || chr(10) || 'at https://app.test/share y',
          'the stack neither, but keeps a frame''s line and column');
select is((select route from tests.errors_of((select ada from ids), 'T-ERRLOG scrub: GET https://api.test/rest/v1/books failed for [email]')),
          '/share', 'the route is its path only');

select tests.act_as((select ada from ids));
select is(public.log_client_error('shelf', 'T-ERRLOG long ' || repeat('m', 5000), repeat('s', 20000),
                                  '/' || repeat('r', 500), repeat('v', 100), repeat('u', 500)),
          'logged', 'an oversized report is taken');
select is(public.log_client_error('shelf', 'T-ERRLOG not a path', null, 'https://app.test/library?x=1'),
          'logged', 'and one whose route is not a path');
reset role;
select is((select row(char_length(message), char_length(stack), char_length(route), char_length(app_version), char_length(user_agent))::text
             from private.client_errors where user_id = (select ada from ids) and message like 'T-ERRLOG long %'),
          row(1000, 8000, 200, 64, 200)::text,
          'message, stack, route, build and browser are cut to 1000, 8000, 200, 64 and 200 characters');
select is((select route from tests.errors_of((select ada from ids), 'T-ERRLOG not a path')), null,
          'a route that is not a path is left out');

-- ------------------------------------------------------------- a member's limit

select tests.act_as((select bo from ids));
select is((select count(*)::int from generate_series(1, 30) g
            where public.log_client_error('error', 'T-ERRLOG flood ' || g) = 'logged'),
          30, 'a member may add 30 rows in an hour');
select is(public.log_client_error('error', 'T-ERRLOG flood 31'), 'dropped', 'the 31st is dropped quietly');
select is(public.log_client_error('error', 'T-ERRLOG flood 7'), 'counted', 'a repeat of one of them is still counted');
select is(public.log_client_error('error', 'T-ERRLOG not bo''s limit'), 'dropped', 'any other new error is dropped');
select tests.act_as((select ada from ids));
select is(public.log_client_error('error', 'T-ERRLOG ada is not bo'), 'logged', 'another member has her own limit');
reset role;
select is((select count(*)::int from tests.errors_of((select bo from ids), 'T-ERRLOG flood 31')), 0, 'nothing was kept of the dropped one');
select tests.age('T-ERRLOG flood %', interval '61 minutes');
select tests.act_as((select bo from ids));
select is(public.log_client_error('error', 'T-ERRLOG flood 31'), 'logged', 'an hour later there is room again');
reset role;

-- --------------------------------------------------------------- signed out

select tests.act_anon('203.0.113.7');
select is(public.log_client_error('chunk', 'T-ERRLOG anon chunk', null, '/sign-in'), 'logged',
          'a signed-out device reports an error');
select is(public.log_client_error('chunk', 'T-ERRLOG anon chunk', null, '/sign-in'), 'counted',
          'counted like a member''s');
select throws_ok($$select count(*) from private.client_errors$$, '42501', null, 'it cannot read the log');
select throws_ok($$delete from private.client_errors$$, '42501', null, 'nor delete from it');
select is((select count(*)::int from generate_series(2, 10) g
            where public.log_client_error('error', 'T-ERRLOG anon flood ' || g) = 'logged'),
          9, 'one address may add 10 rows in an hour');
select is(public.log_client_error('error', 'T-ERRLOG anon flood 11'), 'dropped', 'the 11th is dropped');
select tests.act_anon('198.51.100.9');
select is(public.log_client_error('error', 'T-ERRLOG anon elsewhere'), 'logged', 'another address has its own limit');
reset role;

select is((select row(user_id, caller_key like 'anon:%', position('203.0.113.7' in caller_key))::text
             from tests.errors_of(null, 'T-ERRLOG anon chunk')),
          row(null::uuid, true, 0)::text, 'a signed-out row is nobody''s and keeps no address');

-- All signed-out callers together: at most 100 rows an hour (made up here; the
-- forwarded-for header can be, too).
insert into private.client_errors (caller_key, kind, message)
select 'anon:T-ERRLOG-' || g, 'error', 'T-ERRLOG anon crowd ' || g from generate_series(1, 100) g;
select tests.act_anon('192.0.2.200');
select is(public.log_client_error('error', 'T-ERRLOG anon crowd new'), 'dropped',
          'past 100 signed-out rows in an hour, a new address is dropped too');
reset role;
select tests.act_as((select ada from ids));
select is(public.log_client_error('error', 'T-ERRLOG member past the crowd'), 'logged', 'members are not held up by it');
reset role;

-- ------------------------------------------------------------ the account goes

delete from auth.users where id = (select bo from ids);
select is((select count(*)::int from private.client_errors where caller_key = 'member:' || (select bo from ids)),
          0, 'a member''s rows go with her account');

-- ------------------------------------------------------------------ the sweep

select tests.age('T-ERRLOG boom', interval '31 days');
select cmp_ok(private.purge_client_errors(), '>=', 2::bigint, 'the sweep reports what it deleted');
select is((select count(*)::int from tests.errors_of((select ada from ids), 'T-ERRLOG boom')), 0,
          'rows older than 30 days are gone');
select isnt((select count(*)::int from tests.errors_of((select ada from ids), 'T-ERRLOG ada is not bo')), 0,
          'younger rows stay');

select case
  when exists (select 1 from pg_extension where extname = 'pg_cron')
  then is((select schedule || ' ' || command from cron.job where jobname = 'purge-client-errors'),
          '45 3 * * * select private.purge_client_errors()', 'pg_cron runs the sweep daily')
  else skip('pg_cron is not installed here', 1)
end;

select * from finish();
rollback;
