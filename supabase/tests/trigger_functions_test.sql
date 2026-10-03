-- Trigger-only functions are closed to the API (issue #47):
--   supabase test db
--
-- The security advisor flags SECURITY DEFINER functions the API roles can
-- execute, and PostgREST would serve every function they can execute as
-- `/rpc/<name>`. The functions that exist only to be fired by a trigger are
-- revoked from PUBLIC, anon and authenticated; Postgres checks that privilege
-- when a trigger is created, not when it fires, so each trigger must still
-- work for the rows it guards. This asserts both: nobody can call them, and
-- each trigger still does its job.

begin;
select plan(26);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-TRIGGERS', 'trigger test', 5);

create or replace function tests.member(p_email text, p_confirmed boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-TRIGGERS"}'::jsonb, case when p_confirmed then now() end, now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.status(p_entry uuid)
returns public.entry_status language sql security definer as $$
  select status from public.library_entries where id = p_entry
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- -------------------------------------------- nobody calls them, over /rpc or otherwise

-- Every function in `public` that returns `trigger`, by name: a new one must be listed here too.
select set_eq(
  $$ select p.proname::text from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype $$,
  $$ values ('handle_new_user'), ('handle_user_confirmed'), ('library_entries_derive_status'),
            ('reading_sessions_update_status'), ('reading_sessions_no_future_dates'),
            ('collection_entries_same_member') $$,
  'these are all the trigger functions in public');

select is_empty(
  $$ select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
        and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('public', p.oid, 'execute')) $$,
  'none of them is executable by anon, authenticated or PUBLIC');

select ok(has_function_privilege('service_role', 'public.handle_new_user()', 'execute')
      and has_function_privilege('postgres', 'public.handle_new_user()', 'execute'),
  'the owner and the service role keep EXECUTE, so Supabase tooling is unaffected');

-- ------------------------------------------------- the triggers still work

-- handle_new_user (judge) and handle_user_confirmed (admit): the invite gate.
select throws_ok(
  $$ insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             'nope@triggers.test', '{"invite_code":"T-NOPE"}', now(), now()) $$,
  null, null, 'handle_new_user still refuses a signup without a live invite');

select tests.member('half@triggers.test', false) as half_id \gset
select is_empty(format($$ select 1 from public.accounts where id = %L $$, :'half_id'),
  'an unconfirmed signup has no account yet');
update auth.users set email_confirmed_at = now() where id = :'half_id';
select isnt_empty(format($$ select 1 from public.accounts where id = %L $$, :'half_id'),
  'handle_user_confirmed still admits the user when the address is proved');

select tests.member('full@triggers.test') as full_id \gset
select isnt_empty(format($$ select 1 from public.accounts where id = %L $$, :'full_id'),
  'handle_new_user still admits a user created already confirmed');

-- library_entries_derive_status / reading_sessions_update_status.
select tests.member('max@triggers.test') as max_id \gset
select tests.act_as(:'full_id');
select (public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000000201"}')).id as piranesi \gset
select is(tests.status(:'piranesi'), 'want_to_read', 'library_entries_derive_status still derives Want to read');
select public.start_reading(:'piranesi', current_date - 2);
select is(tests.status(:'piranesi'), 'reading', 'reading_sessions_update_status still follows a started read');
select public.finish_reading(:'piranesi', current_date - 1);
select is(tests.status(:'piranesi'), 'finished', 'and a finished one');
select throws_ok(
  format($$ update public.library_entries set status = 'want_to_read' where id = %L $$, :'piranesi'),
  null, null, 'a member still cannot write the status');

-- reading_sessions_no_future_dates, as the owner writes sessions.
reset role;
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on) values (%L, current_date + 30) $$, :'piranesi'),
  '22023', 'date_in_future', 'reading_sessions_no_future_dates still refuses a read in the future');

-- collection_entries_same_member.
select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000000202"}')).id as dune \gset
select (public.create_collection('Mine')).id as shelf \gset
reset role;
select throws_ok(
  format($$ insert into public.collection_entries (collection_id, entry_id, position) values (%L, %L, 1) $$, :'shelf', :'piranesi'),
  '23503', 'entry_missing', 'collection_entries_same_member still refuses another member''s entry');
select lives_ok(
  format($$ insert into public.collection_entries (collection_id, entry_id, position) values (%L, %L, 1) $$, :'shelf', :'dune'),
  'and takes her own');

-- -------------------------------------------- and /rpc cannot call them

create or replace function tests.call_as(p_role text, p_function text)
returns void language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  execute format('select %s', p_function);
end;
$$;

select throws_ok(format($$ select tests.call_as('authenticated', %L) $$, 'public.' || f || '()'),
  '42501', format('permission denied for function %s', f), format('authenticated cannot call %s', f))
from unnest(array['handle_new_user', 'handle_user_confirmed', 'library_entries_derive_status',
                  'reading_sessions_update_status', 'reading_sessions_no_future_dates',
                  'collection_entries_same_member']) as f;

select throws_ok(format($$ select tests.call_as('anon', %L) $$, 'public.' || f || '()'),
  '42501', format('permission denied for function %s', f), format('anon cannot call %s', f))
from unnest(array['handle_new_user', 'handle_user_confirmed', 'library_entries_derive_status',
                  'reading_sessions_update_status', 'reading_sessions_no_future_dates',
                  'collection_entries_same_member']) as f;

select * from finish();
rollback;
