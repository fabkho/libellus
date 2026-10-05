-- update_session, delete_session and remove_from_library at the database
-- boundary (issue #11):
--   supabase test db
--
-- A member fixes a read (its dates and, by its outcome, the Rating and review
-- or the abandon reason) with the rules of creating it; deletes one read, and
-- the entry's Status follows from the reads it has left (the only one gone:
-- Want to read); removes an entry, which takes its sessions and Collection
-- memberships with it and nothing else. Members act through their JWT claims
-- and only on their own entries. Assertions ask about the rows this test made,
-- never about how many rows a table holds.

begin;
select plan(80);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-HISTORY', 'history test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-HISTORY"}'::jsonb, now(), now(), now());
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

-- What the tables hold, past the members' own RLS.
create or replace function tests.status(p_entry uuid)
returns public.entry_status language sql security definer as $$
  select status from public.library_entries where id = p_entry
$$;

create or replace function tests.sessions_of(p_entry uuid)
returns bigint language sql security definer as $$
  select count(*) from public.reading_sessions where entry_id = p_entry
$$;

create or replace function tests.entry_exists(p_entry uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.library_entries where id = p_entry)
$$;

create or replace function tests.on_collections(p_entry uuid)
returns bigint language sql security definer as $$
  select count(*) from public.collection_entries where entry_id = p_entry
$$;

create or replace function tests.book_exists(p_book uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.books where id = p_book)
$$;

-- The one session of an entry, or its latest by the entry's own definition.
create or replace function tests.session_id(p_entry uuid, p_nth integer default 1)
returns uuid language sql security definer as $$
  select id from (
    select id, row_number() over (order by started_on nulls first, created_at) as n
      from public.reading_sessions where entry_id = p_entry
  ) s where n = p_nth
$$;

select tests.member('ida@history.test') as ida_id \gset
select tests.member('max@history.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida's Library:
--   Dune      finished, 4.25 stars and a review
--   Emma      being read since 6 days ago
--   Ubik      abandoned, with a reason
--   Kindred   read twice: finished, then being read again
--   Solaris   Want to read (no read)
--   Piranesi  finished, on two Collections (removed below)
-- Max has one Book with a finished read.
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000001101"}',
  'finished', current_date - 30, current_date - 20, 17, 'Sand.')).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000001102"}',
  'reading', current_date - 6)).id as emma \gset
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000001103"}')).id as ubik \gset
select public.start_reading(:'ubik', current_date - 9);
select public.abandon_reading(:'ubik', current_date - 4, 'Too strange.');
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000001104"}',
  'finished', current_date - 90, current_date - 80, 12, null)).id as kindred \gset
select public.read_again(:'kindred', current_date - 3);
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000001105"}')).id as solaris \gset
select (public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000001106"}',
  'finished', current_date - 50, current_date - 40, 20, 'A house of statues.')).id as piranesi \gset
select (public.add_to_library('{"title":"Hyperion","source":"apple","apple_id":"990000001107"}',
  'finished', current_date - 60, current_date - 55, 8, null)).id as hyperion \gset
select book_id as piranesi_book from public.library_entries where id = :'piranesi' \gset
select public.create_collection('Houses');
select id as houses from public.collections where name = 'Houses' and member_id = :'ida_id' \gset
select public.create_collection('Statues');
select id as statues from public.collections where name = 'Statues' and member_id = :'ida_id' \gset
select public.add_to_collection(:'houses', '{"title":"Piranesi","source":"apple","apple_id":"990000001106"}');
select public.add_to_collection(:'houses', '{"title":"Hyperion","source":"apple","apple_id":"990000001107"}');
select public.add_to_collection(:'statues', '{"title":"Piranesi","source":"apple","apple_id":"990000001106"}');

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000001105"}',
  'finished', current_date - 10, current_date - 5, 10, 'Ocean.')).id as max_solaris \gset

select tests.act_as(:'ida_id');
select tests.session_id(:'dune') as dune_s \gset
select tests.session_id(:'emma') as emma_s \gset
select tests.session_id(:'ubik') as ubik_s \gset
select tests.session_id(:'kindred', 1) as kindred_old \gset
select tests.session_id(:'kindred', 2) as kindred_new \gset
select tests.session_id(:'max_solaris') as max_s \gset
select tests.session_id(:'piranesi') as piranesi_s \gset
select tests.session_id(:'hyperion') as hyperion_s \gset

-- ------------------------------------------------------------- update_session

-- A finished read: dates, Rating and review.
select lives_ok(
  format($$ select public.update_session(%L, current_date - 31, current_date - 21, 15, E'  Dust and spice.\n ') $$, :'dune_s'),
  'a member edits a finished read: dates, Rating and review');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, rating, review, abandon_reason from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (current_date - 31, current_date - 21, 'finished', 15::smallint, 'Dust and spice.', null::text) $$,
  'the same session now has them, the review trimmed, its outcome unchanged');
select is(tests.status(:'dune'), 'finished', 'and the entry is still Finished');

select lives_ok(
  format($$ select public.update_session(%L, null, current_date - 21) $$, :'dune_s'),
  'the start day of a finished read may go: a read has no start when it was logged later');
select results_eq(
  format($$ select started_on, rating, review from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (null::date, null::smallint, null::text) $$,
  'and leaving out the Rating and review clears them: an edit sends the whole read');
select lives_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date - 21, 4, '   ') $$, :'dune_s'),
  'a blank review is none, 4 is a whole star');
select results_eq(
  format($$ select rating, review from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (4::smallint, null::text) $$,
  'stored as no review');

select throws_ok(
  format($$ select public.update_session(%L, current_date - 20, current_date - 21) $$, :'dune_s'),
  '22023', 'ended_before_started', 'a finished read cannot end before it started');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date + 3) $$, :'dune_s'),
  '22023', 'date_in_future', 'nor end in the future');
select throws_ok(
  format($$ select public.update_session(%L, current_date + 3, current_date + 4) $$, :'dune_s'),
  '22023', 'date_in_future', 'nor start in the future');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, null) $$, :'dune_s'),
  '22023', 'date_invalid', 'a read that has an end day cannot lose it');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date - 21, 21) $$, :'dune_s'),
  '22023', 'rating_invalid', 'a Rating over 5 stars is refused');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date - 21, 0) $$, :'dune_s'),
  '22023', 'rating_invalid', 'and a Rating of 0: unrated is none, not zero');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date - 21, 4, repeat('x', 10001)) $$, :'dune_s'),
  '22023', 'review_too_long', 'a review over 10,000 characters is refused');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 22, current_date - 21, 4, null, 'Boring.') $$, :'dune_s'),
  '22023', 'session_invalid', 'a finished read has no abandon reason');
select results_eq(
  format($$ select started_on, ended_on, rating from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (current_date - 22, current_date - 21, 4::smallint) $$,
  'after all those refusals the read is as the last edit left it');

-- A read being read: its start day only.
select lives_ok(
  format($$ select public.update_session(%L, current_date - 8, null) $$, :'emma_s'),
  'a member moves the start of the read she is on');
select results_eq(
  format($$ select started_on, ended_on, outcome::text from public.reading_sessions where id = %L $$, :'emma_s'),
  $$ values (current_date - 8, null::date, null::text) $$,
  'it stays open');
select is(tests.status(:'emma'), 'reading', 'and the entry stays Currently reading');
select throws_ok(
  format($$ select public.update_session(%L, null, null) $$, :'emma_s'),
  '22023', 'date_invalid', 'an open read needs its start day');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 8, current_date) $$, :'emma_s'),
  '22023', 'session_invalid', 'an edit does not finish it: an open read has no end day');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 8, null, 12) $$, :'emma_s'),
  '22023', 'session_invalid', 'nor rate it');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 8, null, null, 'So far so good.') $$, :'emma_s'),
  '22023', 'session_invalid', 'nor review it');
select throws_ok(
  format($$ select public.update_session(%L, current_date + 2, null) $$, :'emma_s'),
  '22023', 'date_in_future', 'its start cannot be in the future');

-- An abandoned read: dates and the reason.
select lives_ok(
  format($$ select public.update_session(%L, current_date - 10, current_date - 5, null, null, E'  Lost the thread.\n') $$, :'ubik_s'),
  'a member edits an abandoned read: dates and reason');
select results_eq(
  format($$ select started_on, ended_on, outcome::text, abandon_reason from public.reading_sessions where id = %L $$, :'ubik_s'),
  $$ values (current_date - 10, current_date - 5, 'abandoned', 'Lost the thread.') $$,
  'stored with the reason trimmed, still abandoned');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 10, current_date - 5, 8) $$, :'ubik_s'),
  '22023', 'session_invalid', 'an abandoned read has no Rating');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 10, current_date - 5, null, 'Nope.') $$, :'ubik_s'),
  '22023', 'session_invalid', 'and no review');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 10, current_date - 5, null, null, repeat('x', 1001)) $$, :'ubik_s'),
  '22023', 'reason_too_long', 'a reason over 1,000 characters is refused');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 4, current_date - 5) $$, :'ubik_s'),
  '22023', 'ended_before_started', 'an abandoned read cannot end before it started');
select lives_ok(
  format($$ select public.update_session(%L, current_date - 10, current_date - 5) $$, :'ubik_s'),
  'the reason is optional');
select is(
  (select abandon_reason from public.reading_sessions where id = :'ubik_s'),
  null, 'leaving it out clears it');
select is(
  (select tests.status(:'ubik')::text), 'finished', 'and the entry is still Finished, not finished');

-- The edit decides which read is the latest: the entry's own definition.
select lives_ok(
  format($$ select public.update_session(%L, current_date - 2, current_date - 1, 20) $$, :'kindred_old'),
  'a member moves her first read of Kindred past her second');
select is(
  (select s.id from public.library_entries e, public.latest_session(e) s where e.id = :'kindred'),
  :'kindred_new'::uuid, 'the open read is still the latest: an open read always is');
select is(tests.status(:'kindred'), 'reading', 'and the entry is still Currently reading');

-- Not hers.
select throws_ok(
  format($$ select public.update_session(%L, current_date - 5, current_date - 4, 4) $$, :'max_s'),
  'P0002', 'session_not_found', 'another member''s read cannot be edited');
select throws_ok(
  $$ select public.update_session(gen_random_uuid(), current_date, current_date) $$,
  'P0002', 'session_not_found', 'nor one that does not exist');

select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.update_session(%L, current_date - 5, current_date - 4, 4) $$, :'dune_s'),
  'P0002', 'session_not_found', 'and the same the other way round');
select results_eq(
  format($$ select rating, review from public.reading_sessions where id = %L $$, :'max_s'),
  $$ values (10::smallint, 'Ocean.') $$,
  'his read is as he left it');

-- An undated read (logged after the fact, imported) can be edited without a day.
reset role;
insert into public.reading_sessions (entry_id, outcome, rating)
values (:'solaris', 'finished', 6)
returning id as undated_s \gset
select tests.act_as(:'ida_id');
select lives_ok(
  format($$ select public.update_session(%L, null, null, 18, 'Better the second time.') $$, :'undated_s'),
  'a finished read with no days at all can be rated and reviewed without inventing one');
select results_eq(
  format($$ select ended_on, rating, review from public.reading_sessions where id = %L $$, :'undated_s'),
  $$ values (null::date, 18::smallint, 'Better the second time.') $$,
  'and stays undated');
select lives_ok(
  format($$ select public.update_session(%L, null, current_date - 1) $$, :'undated_s'),
  'it may be given an end day');
-- Put Solaris back to Want to read for the next block.
select public.delete_session(:'undated_s');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select public.update_session(%L, current_date - 5, current_date - 4) $$, :'dune_s'),
  '42501', null, 'a visitor cannot edit a read');

-- ------------------------------------------------------------- delete_session

reset role;
select tests.act_as(:'ida_id');

select throws_ok(
  format($$ select public.delete_session(%L) $$, :'max_s'),
  'P0002', 'session_not_found', 'another member''s read cannot be deleted');
select throws_ok(
  $$ select public.delete_session(gen_random_uuid()) $$,
  'P0002', 'session_not_found', 'nor one that does not exist');
select is(tests.sessions_of(:'max_solaris'), 1::bigint, 'and his read is still there');

-- The only session: back to Want to read.
select lives_ok(
  format($$ select public.delete_session(%L) $$, :'dune_s'),
  'a member deletes the only read of a Finished entry');
select is(tests.sessions_of(:'dune'), 0::bigint, 'it is gone');
select is(tests.status(:'dune'), 'want_to_read', 'and the entry is Want to read again');
select is(tests.entry_exists(:'dune'), true, 'the entry itself stays');

select lives_ok(
  format($$ select public.delete_session(%L) $$, :'emma_s'),
  'the open read of a Currently reading entry can be deleted too (a start logged by accident)');
select is(tests.status(:'emma'), 'want_to_read', 'which returns it to Want to read');

select throws_ok(
  format($$ select public.delete_session(%L) $$, :'dune_s'),
  'P0002', 'session_not_found', 'a read cannot be deleted twice');

-- One of several: the entry follows what is left.
select lives_ok(
  format($$ select public.delete_session(%L) $$, :'kindred_new'),
  'the second read of Kindred, the open one, is deleted');
select is(tests.sessions_of(:'kindred'), 1::bigint, 'the first read stays');
select is(tests.status(:'kindred'), 'finished', 'and the entry is Finished again, as that read says');
select results_eq(
  format($$ select id, rating from public.reading_sessions where entry_id = %L $$, :'kindred'),
  format($$ values (%L::uuid, 20::smallint) $$, :'kindred_old'),
  'with the read as it was left');

select public.read_again(:'kindred', current_date - 1);
select lives_ok(
  format($$ select public.delete_session(%L) $$, :'kindred_old'),
  'the earlier read can go while a later one is open');
select is(tests.status(:'kindred'), 'reading', 'the entry is still Currently reading');

select public.delete_session(tests.session_id(:'ubik'));
select is(tests.status(:'ubik'), 'want_to_read', 'an abandoned only read goes the same way');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select public.delete_session(%L) $$, :'max_s'),
  '42501', null, 'a visitor cannot delete a read');

-- --------------------------------------------------------- remove_from_library

reset role;
select tests.act_as(:'ida_id');

select is(tests.sessions_of(:'piranesi'), 1::bigint, 'Piranesi has its read');
select is(tests.on_collections(:'piranesi'), 2::bigint, 'and is on two Collections');

select throws_ok(
  format($$ select public.remove_from_library(%L) $$, :'max_solaris'),
  'P0002', 'entry_not_found', 'another member''s entry cannot be removed');
select throws_ok(
  $$ select public.remove_from_library(gen_random_uuid()) $$,
  'P0002', 'entry_not_found', 'nor one that does not exist');
select is(tests.entry_exists(:'max_solaris'), true, 'and his entry is still there');

select lives_ok(
  format($$ select public.remove_from_library(%L) $$, :'piranesi'),
  'a member removes an entry from her Library');
select is(tests.entry_exists(:'piranesi'), false, 'the entry is gone');
select is(tests.sessions_of(:'piranesi'), 0::bigint, 'with its sessions');
select is(tests.on_collections(:'piranesi'), 0::bigint, 'and its places on Collections');
select is(
  (select count(*) from public.collections where id in (:'houses', :'statues')),
  2::bigint, 'the Collections stay');
select is(tests.book_exists(:'piranesi_book'), true, 'and the Book stays in the Catalogue');
select results_eq(
  format($$ select e.book_id from public.collection_entries ce join public.library_entries e on e.id = ce.entry_id where ce.collection_id = %L $$, :'houses'),
  format($$ select book_id from public.library_entries where id = %L $$, :'hyperion'),
  'Houses keeps its other Book');

select throws_ok(
  format($$ select public.remove_from_library(%L) $$, :'piranesi'),
  'P0002', 'entry_not_found', 'an entry cannot be removed twice');

select lives_ok(
  format($$ select public.remove_from_library(%L) $$, :'kindred'),
  'an entry that is being read can be removed');
select is(tests.sessions_of(:'kindred'), 0::bigint, 'its open read goes with it');

select is(
  (select status::text from public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000001106"}')),
  'want_to_read', 'a removed Book can be added again, as a fresh entry on Want to read');

select tests.act_as(:'max_id');
select is(tests.sessions_of(:'max_solaris'), 1::bigint, 'Max''s Library was never touched');

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  format($$ select public.remove_from_library(%L) $$, :'max_solaris'),
  '42501', null, 'a visitor cannot remove an entry');

reset role;
select * from finish();
rollback;
