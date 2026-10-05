-- Reading sessions, the derived Status, start_reading and finish_reading, at
-- the database boundary:
--   supabase test db
--
-- What every client gets for free (issue #1, Data model; issue #7): the
-- Status follows from the sessions and cannot be written; an entry has at most
-- one open session; an end is never before its start; no date is in the
-- future; a Rating is 1–20 quarters and only on a finished read. Members act
-- through their JWT claims and only on their own entries. The table rules are
-- also checked the way the owner's import (#17) will write, as the service
-- role, so no path around the functions gets past them. Assertions ask about
-- the rows this test made, never about how many rows a table holds.

begin;
select plan(60);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-SESSIONS', 'sessions test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-SESSIONS"}'::jsonb, now(), now(), now());
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

-- The way the import script (#17) writes: the service role, past RLS.
create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;

create or replace function tests.status(p_entry uuid)
returns public.entry_status language sql security definer as $$
  select status from public.library_entries where id = p_entry
$$;

select tests.member('ida@sessions.test') as ida_id \gset
select tests.member('max@sessions.test') as max_id \gset

grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

-- Ida's Library: three Books, all Want to read. Max has one of his own.
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000000101"}')).id as piranesi \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000000102"}')).id as kindred \gset
select (public.add_to_library('{"title":"Ruin","source":"apple","apple_id":"990000000103"}')).id as ruin \gset
select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000000104"}')).id as dune \gset

-- ------------------------------------------------------------ start_reading

select tests.act_as(:'ida_id');

select is(tests.status(:'piranesi'), 'want_to_read', 'an entry without sessions is Want to read');
select is_empty(
  format($$ select 1 from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  'and has no session');

select lives_ok(
  format($$ select public.start_reading(%L, current_date - 3) $$, :'piranesi'),
  'a member starts reading a Want to read Book');
select is(tests.status(:'piranesi'), 'reading', 'which makes it Currently reading');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, rating from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  $$ values (current_date - 3, null::date, null::text, null::smallint) $$,
  'through one open session with its start date');

select throws_ok(
  format($$ select public.start_reading(%L, current_date) $$, :'piranesi'),
  '23505', 'already_reading', 'starting it again is refused: one open read at a time');
select throws_ok(
  format($$ select public.start_reading(%L, current_date + 2) $$, :'kindred'),
  '22023', 'date_in_future', 'a start in the future is refused');
select lives_ok(
  format($$ select public.start_reading(%L, (now() at time zone 'Etc/GMT-14')::date) $$, :'ruin'),
  'but today counts wherever on Earth it is already today');
select throws_ok(
  format($$ select public.start_reading(%L, null) $$, :'kindred'),
  '22023', 'date_invalid', 'a start needs a date');
select is(tests.status(:'kindred'), 'want_to_read', 'and a refused start changes nothing');
select throws_ok(
  format($$ select public.start_reading(%L, current_date) $$, :'dune'),
  'P0002', 'entry_not_found', 'another member''s entry is not found');
select throws_ok(
  $$ select public.start_reading(gen_random_uuid(), current_date) $$,
  'P0002', 'entry_not_found', 'nor is an entry that does not exist');

-- ------------------------------------------------------------ finish_reading

select throws_ok(
  format($$ select public.finish_reading(%L, current_date) $$, :'kindred'),
  '22023', 'not_reading', 'a Book that is not being read cannot be finished');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date - 4) $$, :'piranesi'),
  '22023', 'ended_before_started', 'nor end before it started');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date + 2) $$, :'piranesi'),
  '22023', 'date_in_future', 'nor end in the future');
select throws_ok(
  format($$ select public.finish_reading(%L, null) $$, :'piranesi'),
  '22023', 'date_invalid', 'a finish needs an end date');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date, 0) $$, :'piranesi'),
  '22023', 'rating_invalid', 'a Rating of zero quarters is refused (unrated is null)');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date, 21) $$, :'piranesi'),
  '22023', 'rating_invalid', 'and so is more than five stars');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date, null, repeat('x', 10001)) $$, :'piranesi'),
  '22023', 'review_too_long', 'a review over 10,000 characters is refused');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date) $$, :'dune'),
  'P0002', 'entry_not_found', 'another member''s read cannot be finished');
select is(tests.status(:'piranesi'), 'reading', 'and after all those refusals it is still being read');

select lives_ok(
  format($$ select public.finish_reading(%L, current_date - 1, 15, E'  A house of tides.\n ') $$, :'piranesi'),
  'a member finishes the Book with an end date, 3.75 stars and a review');
select is(tests.status(:'piranesi'), 'finished', 'which makes it Finished');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, rating, review from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  $$ values (current_date - 3, current_date - 1, 'finished', 15::smallint, 'A house of tides.') $$,
  'the same session closes with the date, the quarters and the trimmed review');

select lives_ok(
  format($$ select public.finish_reading(%L, (now() at time zone 'Etc/GMT-14')::date, null, '   ') $$, :'ruin'),
  'finishing without a Rating or a review is fine, on the day it started');
select results_eq(
  format($$ select outcome::text, rating, review from public.reading_sessions where entry_id = %L $$, :'ruin'),
  $$ values ('finished', null::smallint, null::text) $$,
  'unrated, and a blank review is no review');

select throws_ok(
  format($$ select public.finish_reading(%L, current_date) $$, :'piranesi'),
  '22023', 'not_reading', 'a finished Book cannot be finished twice');
select throws_ok(
  format($$ select public.start_reading(%L, current_date) $$, :'piranesi'),
  '22023', 'already_finished', 'nor started as a first read: that is Read again (#10)');

-- ------------------------------------------------- the latest session, read

select results_eq(
  format($$ select s.rating from public.library_entries e, public.latest_session(e) s where e.id = %L $$, :'piranesi'),
  $$ values (15::smallint) $$,
  'an entry''s latest session is readable with it');

-- ------------------------------------------------------- RLS: the sessions

select isnt_empty(
  format($$ select 1 from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  'a member sees her own sessions');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on) values (%L, current_date) $$, :'kindred'),
  '42501', null, 'but cannot write a session directly');
select throws_ok(
  format($$ update public.reading_sessions set rating = 20 where entry_id = %L $$, :'piranesi'),
  '42501', null, 'nor change one behind the Library actions'' back');
select throws_ok(
  format($$ delete from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  '42501', null, 'nor delete one');
select throws_ok(
  format($$ update public.library_entries set status = 'want_to_read' where id = %L $$, :'piranesi'),
  '42501', null, 'nor write a status');

select tests.act_as(:'max_id');
select is_empty(
  format($$ select 1 from public.reading_sessions where entry_id = %L $$, :'piranesi'),
  'another member sees none of her sessions');
select is_empty(
  format($$ select 1 from public.library_entries e, public.latest_session(e) s where e.id = %L $$, :'piranesi'),
  'not even through the latest session');

-- ---------------------------------------------- a visitor, no JWT, no session

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$ select 1 from public.reading_sessions $$,
  '42501', 'permission denied for table reading_sessions', 'a visitor cannot read any session');
select throws_ok(
  format($$ select public.start_reading(%L, current_date) $$, :'kindred'),
  '42501', null, 'nor start a read');
select throws_ok(
  format($$ select public.finish_reading(%L, current_date) $$, :'ruin'),
  '42501', null, 'nor finish one');

-- --------------------------------------- the table rules, on every write path

reset role;
select tests.act_as_service();

insert into public.reading_sessions (entry_id, started_on) values (:'kindred', current_date);
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on) values (%L, current_date) $$, :'kindred'),
  '23505', null, 'an entry never has two open sessions, whoever writes them');

-- Max's Dune for the rest: the import's way in, session by session.

select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, ended_on, outcome) values (%L, '2024-05-02', '2024-05-01', 'finished') $$, :'dune'),
  '23514', null, 'a session never ends before it started');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome) values (%L, current_date + 2, 'finished') $$, :'dune'),
  '22023', 'date_in_future', 'no date is in the future');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome, rating) values (%L, '2024-05-01', 'finished', 21) $$, :'dune'),
  '23514', null, 'a Rating is at most 20 quarters');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome, rating) values (%L, '2024-05-01', 'finished', 0) $$, :'dune'),
  '23514', null, 'and at least one');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome, rating) values (%L, '2024-05-01', 'abandoned', 8) $$, :'dune'),
  '23514', null, 'an abandoned read has no Rating');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, rating) values (%L, '2024-05-01', 8) $$, :'dune'),
  '23514', null, 'nor has an open one');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, review) values (%L, '2024-05-01', 'So far so good') $$, :'dune'),
  '23514', null, 'a review belongs to a closed read');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome, abandon_reason) values (%L, '2024-05-01', 'finished', 'Slow') $$, :'dune'),
  '23514', null, 'an abandon reason only to an abandoned one');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id) values (%L) $$, :'dune'),
  '23514', null, 'an open read has a start date');
select is(tests.status(:'dune'), 'want_to_read', 'none of that touched the Status');

-- The Status follows the sessions, whatever writes them.
select lives_ok(
  format($$ insert into public.reading_sessions (entry_id, ended_on, outcome, rating) values (%L, '2019-08-01', 'finished', 18) $$, :'dune'),
  'a finished read without a start date (a past read, an import) goes in');
select is(tests.status(:'dune'), 'finished', 'and the entry is Finished');

insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, abandon_reason)
values (:'dune', '2021-02-01', '2021-03-01', 'abandoned', 'Too much sand');
select is(tests.status(:'dune'), 'finished', 'an abandoned read closes the entry too (Not finished is a filter)');
select results_eq(
  format($$ select s.outcome::text from public.library_entries e, public.latest_session(e) s where e.id = %L $$, :'dune'),
  $$ values ('abandoned') $$,
  'the latest session is the one that ended last');

insert into public.reading_sessions (entry_id, started_on) values (:'dune', current_date)
returning id as reread \gset
select is(tests.status(:'dune'), 'reading', 'an open read makes it Currently reading again');
select results_eq(
  format($$ select s.id from public.library_entries e, public.latest_session(e) s where e.id = %L $$, :'dune'),
  format($$ values (%L::uuid) $$, :'reread'),
  'and the open read is the latest');

update public.library_entries set status = 'want_to_read' where id = :'dune';
select is(tests.status(:'dune'), 'reading', 'a status written by hand is overwritten by what the sessions say');

delete from public.reading_sessions where id = :'reread';
select is(tests.status(:'dune'), 'finished', 'deleting the open read leaves it Finished');
delete from public.reading_sessions where entry_id = :'dune';
select is(tests.status(:'dune'), 'want_to_read', 'deleting every read puts it back on Want to read');

insert into public.reading_sessions (entry_id, started_on) values (:'dune', '2024-01-01');
delete from public.library_entries where id = :'dune';
select is_empty(
  format($$ select 1 from public.reading_sessions where entry_id = %L $$, :'dune'),
  'removing an entry removes its sessions');

reset role;
select * from finish();
rollback;
