-- The owner reads the client error log in the app:
--   supabase test db
--
-- `owner_client_errors` and `owner_client_error_detail` answer the one member named in
-- `private.instance_owner`, and nobody else: any other member, a signed-out caller (not even
-- granted) and everyone while no owner is named get `not_owner` (42501). The owner gets the
-- last days' errors grouped by kind and message, with how many members each touched and
-- never their ids, and the newest report of a group with its stack. Assertions ask about
-- the rows this test made (its messages start with T-OWNERR), never about the table's size.

begin;
select plan(35);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-OWNERR', 'owner client errors test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-OWNERR"}'::jsonb, now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.headers', '{"x-forwarded-for":"203.0.113.9"}', true);
  execute 'set local role anon';
end;
$$;

-- A report as the table would hold it, `p_ago` ago (first and last seen), made as the owner of the schema.
create or replace function tests.report(p_user uuid, p_kind text, p_message text, p_ago interval, p_count integer,
                                        p_version text, p_route text, p_standalone boolean, p_online boolean,
                                        p_stack text default null)
returns void language sql security definer as $$
  insert into private.client_errors
    (user_id, caller_key, kind, message, stack, route, app_version, standalone, online, count, created_at, last_seen_at)
  values (p_user, coalesce('member:' || p_user, 'anon:t-ownerr'), p_kind, p_message, p_stack, p_route, p_version,
          p_standalone, p_online, p_count, now() - p_ago, now() - p_ago)
$$;

-- Who the owner is: set as the schema's owner, as an operator does in SQL.
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;

grant execute on all functions in schema tests to public;
grant usage on schema tests to public;

create temp table ids on commit drop as
  select tests.member('ownerr-ada@libellus.test') as ada,
         tests.member('ownerr-bo@libellus.test') as bo,
         tests.member('ownerr-cy@libellus.test') as cy;
grant select on ids to public;

-- ----------------------------------------------------------------- what is built

select is((select count(*)::int from private.instance_owner), 1, 'the instance has one owner row, empty until its operator sets it');
select throws_ok($$insert into private.instance_owner (id) values (false)$$, '23514', null, 'and it can only be one');
select ok(not has_function_privilege('anon', 'public.owner_client_errors(integer)', 'execute'), 'anon is not granted the groups');
select ok(not has_function_privilege('anon', 'public.owner_client_error_detail(text)', 'execute'), 'nor the detail');
select ok(has_function_privilege('authenticated', 'public.owner_client_errors(integer)', 'execute'), 'signed-in members are granted the groups (the owner check is inside)');
select ok(not has_function_privilege('authenticated', 'private.is_instance_owner()', 'execute'), 'the owner check itself is not callable by members');
select ok(pg_get_function_result('public.owner_client_errors(integer)'::regprocedure) !~ 'uuid',
          'the groups carry no member id, only how many members');

-- Some errors. Ada and Bo (and a signed-out device) meet the same one; one is old and returned.
select tests.report((select ada from ids), 'error', 'T-OWNERR boom', interval '3 hours', 2, 'build-1', '/library', true, true,
                    'at f (https://app.test/_nuxt/a.js:1:2)');
select tests.report((select ada from ids), 'error', 'T-OWNERR boom', interval '2 days', 1, 'build-1', '/profile', false, true,
                    'at f (https://app.test/_nuxt/old.js:1:2)');
select tests.report((select bo from ids), 'error', 'T-OWNERR boom', interval '1 hour', 4, 'build-2', '/library', false, false,
                    'at g (https://app.test/_nuxt/b.js:3:4)');
select tests.report(null, 'error', 'T-OWNERR boom', interval '5 hours', 1, null, null, null, null);
select tests.report((select bo from ids), 'outbox', 'T-OWNERR finish_reading refused: not_reading', interval '30 minutes', 1,
                    'build-2', '/book/x', true, false);
-- Seen first 20 days ago, again today: old, not new. Another only 20 days ago: out of the week.
select tests.report((select ada from ids), 'chunk', 'T-OWNERR old friend', interval '20 days', 1, 'build-0', '/', true, true);
select tests.report((select ada from ids), 'chunk', 'T-OWNERR old friend', interval '45 minutes', 1, 'build-2', '/', true, true);
select tests.report((select ada from ids), 'vue', 'T-OWNERR long gone', interval '20 days', 3, 'build-0', '/', true, true);

-- ---------------------------------------------------------------- not the owner

-- Nobody is named: nobody may.
select tests.name_owner(null);
select tests.act_as((select ada from ids));
select throws_ok($$select * from public.owner_client_errors()$$, '42501', 'not_owner', 'while nobody is named, no member reads the groups');
select throws_ok($$select * from public.owner_client_error_detail('x')$$, '42501', 'not_owner', 'nor a detail');
reset role;

-- Ada is named; the others are not.
select tests.name_owner((select ada from ids));
select tests.act_as((select bo from ids));
select throws_ok($$select * from public.owner_client_errors()$$, '42501', 'not_owner', 'a member who is not the owner is refused the groups');
select throws_ok($$select * from public.owner_client_errors(30)$$, '42501', 'not_owner', 'whatever window she asks for');
select throws_ok($$select * from public.owner_client_error_detail('x')$$, '42501', 'not_owner', 'and a detail');
select throws_ok($$select * from private.instance_owner$$, '42501', null, 'and cannot read who the owner is');
select throws_ok($$update private.instance_owner set owner_id = null$$, '42501', null, 'nor name herself');
reset role;

select tests.act_anon();
select throws_ok($$select * from public.owner_client_errors()$$, '42501', null, 'a signed-out caller may not even call the groups');
select throws_ok($$select * from public.owner_client_error_detail('x')$$, '42501', null, 'nor the detail');
reset role;

-- ------------------------------------------------------------------- the owner

select tests.act_as((select ada from ids));

select is((select count(*)::int from public.owner_client_errors() where message like 'T-OWNERR%'), 3,
          'the owner gets this test''s groups of the last 7 days: boom, finish_reading, old friend (long gone is out)');
select is((select count(*)::int from public.owner_client_errors(30) where message like 'T-OWNERR%'), 4,
          'asking for 30 days brings the oldest in too');
select is((select count(*)::int from public.owner_client_errors(0) where message like 'T-OWNERR%'), 3,
          'a window under one day is one day');
select is((select count(*)::int from public.owner_client_errors(1000) where message like 'T-OWNERR%'), 4,
          'and over 30 is 30, what the log keeps');

select is((select times from public.owner_client_errors(7) where message = 'T-OWNERR boom'), 8::bigint, 'a group counts the times of every report in the week: 2 + 1 + 4 + 1');
select is((select members from public.owner_client_errors(7) where message = 'T-OWNERR boom'), 2::bigint, 'how many members it touched, a signed-out device not among them');
select is((select signed_out_times from public.owner_client_errors(7) where message = 'T-OWNERR boom'), 1::bigint, 'and how often signed-out devices met it');
select is((select app_versions from public.owner_client_errors(7) where message = 'T-OWNERR boom'), array['build-1', 'build-2'], 'the builds, without the report that had none');
select is((select routes from public.owner_client_errors(7) where message = 'T-OWNERR boom'), array['/library', '/profile'], 'and the routes');
select is((select row(standalone_times, browser_times, online_times, offline_times)::text from public.owner_client_errors(7) where message = 'T-OWNERR boom'),
          row(2::bigint, 5::bigint, 3::bigint, 4::bigint)::text,
          'installed vs in a tab and online vs offline, by times, the reports that did not say left out');
select ok((select last_seen > now() - interval '2 hours' and first_seen < now() - interval '47 hours' from public.owner_client_errors(7) where message = 'T-OWNERR boom'),
          'first and last seen');
select is((select kind from public.owner_client_errors(7) where message = 'T-OWNERR finish_reading refused: not_reading'), 'outbox', 'a group has its kind');
select ok((select first_seen < now() - interval '19 days' from public.owner_client_errors(7) where message = 'T-OWNERR old friend'),
          'an old error that came back keeps the day it was first seen, so it is not taken for new');
select is((select times from public.owner_client_errors(7) where message = 'T-OWNERR old friend'), 1::bigint, 'but is counted over the week only');
select is((select array_agg(message order by last_seen desc) from public.owner_client_errors() where message like 'T-OWNERR%'),
          array['T-OWNERR finish_reading refused: not_reading', 'T-OWNERR old friend', 'T-OWNERR boom'],
          'newest first');

-- One group's newest report.
select is((select stack from public.owner_client_error_detail((select message_hash from public.owner_client_errors(7) where message = 'T-OWNERR boom'))),
          'at g (https://app.test/_nuxt/b.js:3:4)', 'the detail is the newest report of the group, its stack');
select is((select row(kind, message, route, app_version, standalone, online)::text
             from public.owner_client_error_detail((select message_hash from public.owner_client_errors(7) where message = 'T-OWNERR boom'))),
          row('error', 'T-OWNERR boom', '/library', 'build-2', false, false)::text, 'with where and on what it happened');
select is((select count(*)::int from public.owner_client_error_detail('nothing')), 0, 'a hash nobody has is no row');
select is((select count(*)::int from public.owner_client_error_detail(null)), 0, 'nor none');

reset role;

select * from finish();
rollback;
