-- abandon_reading and read_again at the database boundary (issue #10):
--   supabase test db
--
-- Abandoning ends the open read as abandoned, with a day and an optional
-- reason, and the entry is Finished; the *Not finished* filter is the entries
-- whose latest session is abandoned. Reading again opens a new session, only
-- when the latest one is closed, and keeps the earlier ones. Members act
-- through their JWT claims and only on their own entries. Assertions ask
-- about the rows this test made, never about how many rows a table holds.

begin;
select plan(45);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-ABANDON', 'abandon test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-ABANDON"}'::jsonb, now(), now(), now());
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

-- The *Not finished* filter: the entries whose latest session was abandoned.
create or replace function tests.not_finished(p_member uuid)
returns table (id uuid) language sql security definer as $$
  select e.id
    from public.library_entries e, public.latest_session(e) s
   where e.member_id = p_member and e.status = 'finished' and s.outcome = 'abandoned'
$$;

create or replace function tests.is_not_finished(p_entry uuid)
returns boolean language sql security definer as $$
  select exists (
    select 1
      from public.library_entries e, public.latest_session(e) s
     where e.id = p_entry and e.status = 'finished' and s.outcome = 'abandoned')
$$;

select tests.member('ida@abandon.test') as ida_id \gset
select tests.member('max@abandon.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida's Library: Dune is being read, Emma was never started, Ubik is being read
-- for the filter. Max has one Book of his own.
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000000201"}')).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000000202"}')).id as emma \gset
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000000203"}')).id as ubik \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000000204"}')).id as kindred \gset
select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000000205"}')).id as solaris \gset
select public.start_reading(:'solaris', current_date - 1);

select tests.act_as(:'ida_id');
select public.start_reading(:'dune', current_date - 10);
select public.start_reading(:'ubik', current_date - 5);

-- ------------------------------------------------------------ abandon_reading

select throws_ok(
  format($$ select public.abandon_reading(%L, current_date) $$, :'emma'),
  '22023', 'not_reading', 'a Book that is not being read cannot be abandoned');
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date - 11) $$, :'dune'),
  '22023', 'ended_before_started', 'nor end before it started');
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date + 2) $$, :'dune'),
  '22023', 'date_in_future', 'nor end in the future');
select throws_ok(
  format($$ select public.abandon_reading(%L, null) $$, :'dune'),
  '22023', 'date_invalid', 'an abandon needs a day');
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date, repeat('x', 1001)) $$, :'dune'),
  '22023', 'reason_too_long', 'a reason over 1,000 characters is refused');
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date) $$, :'solaris'),
  'P0002', 'entry_not_found', 'another member''s read cannot be abandoned');
select throws_ok(
  $$ select public.abandon_reading(gen_random_uuid(), current_date) $$,
  'P0002', 'entry_not_found', 'nor one that does not exist');
select is(tests.status(:'dune'), 'reading', 'and after all those refusals it is still being read');

select lives_ok(
  format($$ select public.abandon_reading(%L, current_date - 2, E'  Too much sand.\n ') $$, :'dune'),
  'a member abandons the read with a day and a reason');
select is(tests.status(:'dune'), 'finished', 'which moves the entry to Finished');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, rating, review, abandon_reason from public.reading_sessions where entry_id = %L $$, :'dune'),
  $$ values (current_date - 10, current_date - 2, 'abandoned', null::smallint, null::text, 'Too much sand.') $$,
  'the same session closes as abandoned, with the day and the trimmed reason, and no Rating');
select results_eq(
  format($$ select s.outcome::text from public.library_entries e, public.latest_session(e) s where e.id = %L $$, :'dune'),
  $$ values ('abandoned') $$,
  'its latest session says it was not finished');

select lives_ok(
  format($$ select public.abandon_reading(%L, current_date, '   ') $$, :'ubik'),
  'the reason is optional: a blank one is none');
select results_eq(
  format($$ select outcome::text, abandon_reason from public.reading_sessions where entry_id = %L $$, :'ubik'),
  $$ values ('abandoned', null::text) $$,
  'stored as no reason');

select throws_ok(
  format($$ select public.abandon_reading(%L, current_date) $$, :'dune'),
  '22023', 'not_reading', 'an abandoned read cannot be abandoned twice');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date) $$, :'dune'),
  '22023', 'not_reading', 'nor finished');
select throws_ok(
  format($$ select public.start_reading(%L, current_date) $$, :'dune'),
  '22023', 'already_finished', 'nor started as a first read: that is read_again');

-- A read abandoned on the day it started, wherever on Earth it is today.
select public.start_reading(:'kindred', (now() at time zone 'Etc/GMT-14')::date);
select lives_ok(
  format($$ select public.abandon_reading(%L, (now() at time zone 'Etc/GMT-14')::date) $$, :'kindred'),
  'a read can end on its start day, today being the latest anywhere on Earth');

-- --------------------------------------------------------- the Not finished filter

select results_eq(
  format($$ select id from tests.not_finished(%L) order by 1 $$, :'ida_id'),
  format($$ select id from (values (%L::uuid), (%L::uuid), (%L::uuid)) as v(id) order by 1 $$, :'dune', :'ubik', :'kindred'),
  'Not finished is the entries whose latest session was abandoned');
select is(tests.is_not_finished(:'emma'), false, 'a Book never started is not in it');

select public.start_reading(:'emma', current_date - 4);
select public.finish_reading(:'emma', current_date - 1, 16);
select is(tests.is_not_finished(:'emma'), false, 'nor is a finished Book');

-- --------------------------------------------------------------- read_again

select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'solaris'),
  'P0002', 'entry_not_found', 'another member''s Book cannot be read again');
select throws_ok(
  $$ select public.read_again(gen_random_uuid(), current_date) $$,
  'P0002', 'entry_not_found', 'nor one that does not exist');

-- Open latest session: refused, whatever the history.
select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'solaris'),
  '23505', 'already_reading', 'a Book being read cannot be read again until that read is closed');
select tests.act_as(:'ida_id');

-- Never read: its first read is start_reading.
select (public.add_to_library('{"title":"Hyperion","source":"apple","apple_id":"990000000206"}')).id as hyperion \gset
select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'hyperion'),
  '22023', 'never_read', 'a Book on Want to read has no read to repeat');
select is(tests.status(:'hyperion'), 'want_to_read', 'and stays there');

select throws_ok(
  format($$ select public.read_again(%L, null) $$, :'emma'),
  '22023', 'date_invalid', 'a new read needs a start day');
select throws_ok(
  format($$ select public.read_again(%L, current_date + 2) $$, :'emma'),
  '22023', 'date_in_future', 'which cannot be in the future');
select is(tests.status(:'emma'), 'finished', 'a refused read again changes nothing');

-- Read again after finished.
select lives_ok(
  format($$ select public.read_again(%L, current_date - 1) $$, :'emma'),
  'a finished Book is read again');
select is(tests.status(:'emma'), 'reading', 'which makes it Currently reading');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, rating from public.reading_sessions where entry_id = %L order by outcome is null, created_at $$, :'emma'),
  $$ values (current_date - 4, current_date - 1, 'finished', 16::smallint),
         (current_date - 1, null::date, null::text, null::smallint) $$,
  'as a new session, with the first read untouched');
select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'emma'),
  '23505', 'already_reading', 'and not twice');

-- Start again after abandoned.
select lives_ok(
  format($$ select public.read_again(%L, current_date - 1) $$, :'dune'),
  'an abandoned Book is started again');
select is(tests.status(:'dune'), 'reading', 'and is Currently reading');
select is(tests.is_not_finished(:'dune'), false, 'so it leaves Not finished while it is read');
select results_eq(
  format($$ select outcome::text, abandon_reason from public.reading_sessions where entry_id = %L order by outcome is null, created_at $$, :'dune'),
  $$ values ('abandoned', 'Too much sand.'), (null::text, null::text) $$,
  'the abandoned read and its reason are kept next to the new one');

-- The latest session decides: abandoned again, then finished after another read.
select public.abandon_reading(:'dune', current_date, 'Still too much sand.');
select is(tests.is_not_finished(:'dune'), true, 'abandoned a second time, it is under Not finished again');
select public.read_again(:'dune', current_date);
select public.finish_reading(:'dune', current_date, 12);
select is(tests.is_not_finished(:'dune'), false, 'finished at last, it is not: the latest session decides');
select results_eq(
  format($$ select count(*)::int, count(*) filter (where outcome = 'abandoned')::int from public.reading_sessions where entry_id = %L $$, :'dune'),
  $$ values (3, 2) $$,
  'with all three reads in its history');

-- Abandon a re-read: finished once, then given up.
select public.abandon_reading(:'emma', current_date, null);
select is(tests.is_not_finished(:'emma'), true, 'a re-read given up puts a finished Book under Not finished: its latest read was not finished');

-- ----------------------------------------------------------------- RLS

select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date) $$, :'dune'),
  'P0002', 'entry_not_found', 'another member cannot abandon her read');
select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'dune'),
  'P0002', 'entry_not_found', 'nor read her Book again');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select public.abandon_reading(%L, current_date) $$, :'solaris'),
  '42501', null, 'a visitor cannot abandon a read');
select throws_ok(
  format($$ select public.read_again(%L, current_date) $$, :'emma'),
  '42501', null, 'nor read a Book again');

reset role;
select * from finish();
rollback;
