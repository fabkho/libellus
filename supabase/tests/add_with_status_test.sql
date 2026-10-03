-- Adding a Book with any status, at the database boundary:
--   supabase test db
--
-- add_to_library (the Catalogue) and add_manual_book (a Manual book) create the
-- entry and its first Reading session in one call (issue #9): Currently reading
-- with a start date, Finished with an end date, an optional start date, an
-- optional Rating and an optional review. The session follows the rules of
-- start_reading and finish_reading: no future dates, an end never before its
-- start, a Rating of 1–20 quarters and only on a finished read. A refusal
-- leaves nothing behind, not the entry, not the session, not a new Catalogue
-- Book. Every assertion acts as a signed-in member through
-- `request.jwt.claims` and asks about the rows this test made.

begin;
select plan(59);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-ADDSTATUS', 'add with status test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-ADDSTATUS"}'::jsonb, now(), now(), now());
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

select tests.member('ida@addstatus.test') as ida_id \gset
select tests.member('max@addstatus.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------- the Catalogue: Currently reading

select tests.act_as(:'ida_id');

select results_eq(
  $$ select status::text from public.add_to_library(
       '{"title":"Piranesi","source":"apple","apple_id":"990000000201"}', 'reading', current_date - 3) $$,
  $$ values ('reading') $$,
  'adding as Currently reading returns the entry already on Currently reading');
select results_eq(
  $$ select s.started_on, s.ended_on, s.outcome::text, s.rating, s.review
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000201' $$,
  $$ values (current_date - 3, null::date, null::text, null::smallint, null::text) $$,
  'with one open session that started on the given day');
select results_eq(
  $$ select e.status::text from public.library_entries e join public.books b on b.id = e.book_id
      where b.apple_id = '990000000201' $$,
  $$ values ('reading') $$,
  'and the stored status is the derived one');

select lives_ok(
  $$ select public.add_to_library(
       '{"title":"Edge","source":"apple","apple_id":"990000000202"}', 'reading',
       (now() at time zone 'Etc/GMT-14')::date) $$,
  'a start that is today somewhere on Earth is accepted');

-- ------------------------------------------------- the Catalogue: Finished

select results_eq(
  $$ select status::text from public.add_to_library(
       '{"title":"Kindred","source":"apple","apple_id":"990000000203"}', 'finished',
       current_date - 20, current_date - 10, 17, E'  Hard to put down.\n ') $$,
  $$ values ('finished') $$,
  'adding as Finished returns the entry already Finished');
select results_eq(
  $$ select s.started_on, s.ended_on, s.outcome::text, s.rating, s.review
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000203' $$,
  $$ values (current_date - 20, current_date - 10, 'finished', 17::smallint, 'Hard to put down.') $$,
  'with one finished session: both days, 4.25 stars, the review trimmed');

select lives_ok(
  $$ select public.add_to_library(
       '{"title":"Dawn","source":"apple","apple_id":"990000000204"}', 'finished',
       null, current_date - 400) $$,
  'a past read needs only the day it ended');
select results_eq(
  $$ select s.started_on, s.ended_on, s.rating, s.review
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000204' $$,
  $$ values (null::date, current_date - 400, null::smallint, null::text) $$,
  'without a start, a Rating or a review');

select lives_ok(
  $$ select public.add_to_library(
       '{"title":"Ruin","source":"apple","apple_id":"990000000205"}', 'finished',
       current_date - 5, current_date - 5, null, E' \n  ') $$,
  'a read that started and ended the same day is fine');
select results_eq(
  $$ select s.review from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000205' $$,
  $$ values (null::text) $$,
  'and a blank review is no review');

select lives_ok(
  $$ select public.add_to_library(
       '{"title":"Both ends","source":"apple","apple_id":"990000000206"}', 'finished',
       null, (now() at time zone 'Etc/GMT-14')::date, 1) $$,
  'an end that is today somewhere on Earth is accepted, with the lowest Rating');
select lives_ok(
  $$ select public.add_to_library(
       '{"title":"Top","source":"apple","apple_id":"990000000207"}', 'finished',
       null, current_date, 20) $$,
  'and the highest Rating, five stars');

-- ----------------------------------------------------- the Catalogue: Want to read

select results_eq(
  $$ select status::text from public.add_to_library(
       '{"title":"Later","source":"apple","apple_id":"990000000208"}') $$,
  $$ values ('want_to_read') $$,
  'adding without a status is still Want to read');
select is_empty(
  $$ select 1 from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000208' $$,
  'and has no session');

-- ------------------------------------------------------- the Catalogue: refusals

select throws_ok(
  $$ select public.add_to_library('{"title":"No start","source":"apple","apple_id":"990000000211"}', 'reading') $$,
  '22023', 'date_invalid', 'Currently reading needs its start date');
select throws_ok(
  $$ select public.add_to_library('{"title":"Future","source":"apple","apple_id":"990000000212"}', 'reading', current_date + 3) $$,
  '22023', 'date_in_future', 'a start in the future is refused');
select throws_ok(
  $$ select public.add_to_library('{"title":"Ended","source":"apple","apple_id":"990000000213"}', 'reading', current_date - 3, current_date - 1) $$,
  '22023', 'session_invalid', 'a read in progress has no end date');
select throws_ok(
  $$ select public.add_to_library('{"title":"Rated","source":"apple","apple_id":"990000000214"}', 'reading', current_date - 3, null, 8) $$,
  '22023', 'session_invalid', 'nor a Rating: only a finished read has one');
select throws_ok(
  $$ select public.add_to_library('{"title":"Reviewed","source":"apple","apple_id":"990000000215"}', 'reading', current_date - 3, null, null, 'Good so far') $$,
  '22023', 'session_invalid', 'nor a review');
select throws_ok(
  $$ select public.add_to_library('{"title":"Dated","source":"apple","apple_id":"990000000216"}', 'want_to_read', current_date) $$,
  '22023', 'session_invalid', 'Want to read has no dates');
select throws_ok(
  $$ select public.add_to_library('{"title":"Stars","source":"apple","apple_id":"990000000217"}', 'want_to_read', null, null, 12) $$,
  '22023', 'session_invalid', 'no Rating');
select throws_ok(
  $$ select public.add_to_library('{"title":"Words","source":"apple","apple_id":"990000000218"}', 'want_to_read', null, null, null, 'Looks good') $$,
  '22023', 'session_invalid', 'and no review');
select throws_ok(
  $$ select public.add_to_library('{"title":"No end","source":"apple","apple_id":"990000000219"}', 'finished', current_date - 3) $$,
  '22023', 'date_invalid', 'Finished needs its end date');
select throws_ok(
  $$ select public.add_to_library('{"title":"Backwards","source":"apple","apple_id":"990000000220"}', 'finished', current_date - 3, current_date - 4) $$,
  '22023', 'ended_before_started', 'an end before the start is refused');
select throws_ok(
  $$ select public.add_to_library('{"title":"Tomorrow","source":"apple","apple_id":"990000000221"}', 'finished', null, current_date + 2) $$,
  '22023', 'date_in_future', 'an end in the future is refused');
select throws_ok(
  $$ select public.add_to_library('{"title":"Long ago","source":"apple","apple_id":"990000000222"}', 'finished', current_date + 2, current_date + 2) $$,
  '22023', 'date_in_future', 'and so is a start in the future');
select throws_ok(
  $$ select public.add_to_library('{"title":"Zero","source":"apple","apple_id":"990000000223"}', 'finished', null, current_date, 0) $$,
  '22023', 'rating_invalid', 'a Rating of zero quarters is refused (unrated is null)');
select throws_ok(
  $$ select public.add_to_library('{"title":"Six","source":"apple","apple_id":"990000000224"}', 'finished', null, current_date, 21) $$,
  '22023', 'rating_invalid', 'and so is more than five stars');
select throws_ok(
  $$ select public.add_to_library('{"title":"Novel","source":"apple","apple_id":"990000000225"}', 'finished', null, current_date, null, repeat('x', 10001)) $$,
  '22023', 'review_too_long', 'a review over 10,000 characters is refused');
select is_empty(
  $$ select 1 from public.books where apple_id::bigint between 990000000211 and 990000000225 $$,
  'and none of those refusals left a Book in the Catalogue');
select is_empty(
  $$ select 1 from public.library_entries e join public.books b on b.id = e.book_id
      where b.apple_id::bigint between 990000000211 and 990000000225 $$,
  'or an entry in the Library');

-- A Book the member has already is refused whatever the status, and keeps its one read.
select throws_ok(
  $$ select public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000000203"}', 'finished', null, current_date) $$,
  '23505', 'already_in_library', 'adding a Book again with a status is refused as before');
select is(
  (select count(*)::integer from public.reading_sessions s
     join public.library_entries e on e.id = s.entry_id
     join public.books b on b.id = e.book_id
    where b.apple_id = '990000000203'),
  1, 'and the Book keeps its one read');

-- Another member adding the same Book gets the same Catalogue row and her own read.
select tests.act_as(:'max_id');
select lives_ok(
  $$ select public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000000203"}', 'reading', current_date - 1) $$,
  'another member adds the same Catalogue Book as Currently reading');
select is(
  (select count(*)::integer from public.books where apple_id = '990000000203'),
  1, 'to the same Catalogue row');
select results_eq(
  $$ select s.started_on, s.rating from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.apple_id = '990000000203' $$,
  $$ values (current_date - 1, null::smallint) $$,
  'and sees only her own read, not Ida''s finished one');

-- --------------------------------------------------- Manual books: every status

select tests.act_as(:'ida_id');

select results_eq(
  $$ select status::text from public.add_manual_book(
       'Zettelkasten Notes', array['Max Mustermann'], null, 312, 'reading', current_date - 2) $$,
  $$ values ('reading') $$,
  'a Manual book is added as Currently reading');
select results_eq(
  $$ select s.started_on, s.ended_on, s.outcome::text
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.title = 'Zettelkasten Notes' $$,
  $$ values (current_date - 2, null::date, null::text) $$,
  'with its open session');

select results_eq(
  $$ select status::text from public.add_manual_book(
       'Die Blechtrommel', array['Günter Grass'], '0-306-40615-2', null, 'finished',
       current_date - 30, current_date - 12, 15, ' Loud. ') $$,
  $$ values ('finished') $$,
  'a Manual book is added as Finished');
select results_eq(
  $$ select s.started_on, s.ended_on, s.outcome::text, s.rating, s.review
       from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.title = 'Die Blechtrommel' $$,
  $$ values (current_date - 30, current_date - 12, 'finished', 15::smallint, 'Loud.') $$,
  'with its finished session, the Rating and the trimmed review');

select lives_ok(
  $$ select public.add_manual_book('Bare minimum', array['Nobody'], null, null, 'finished', null, current_date - 900) $$,
  'a long-past Manual read needs only its end day');
select results_eq(
  $$ select s.started_on, s.ended_on, s.rating from public.reading_sessions s
       join public.library_entries e on e.id = s.entry_id
       join public.books b on b.id = e.book_id
      where b.title = 'Bare minimum' $$,
  $$ values (null::date, current_date - 900, null::smallint) $$,
  'with no start, and no Rating');

select results_eq(
  $$ select status::text from public.add_manual_book('Plain', array['Nobody']) $$,
  $$ values ('want_to_read') $$,
  'without a status it is still Want to read');

-- ------------------------------------------------------------ Manual books: refusals

select throws_ok(
  $$ select public.add_manual_book('M no start', array['Nobody'], null, null, 'reading') $$,
  '22023', 'date_invalid', 'Currently reading needs its start date');
select throws_ok(
  $$ select public.add_manual_book('M future', array['Nobody'], null, null, 'reading', current_date + 1) $$,
  '22023', 'date_in_future', 'a start in the future is refused');
select throws_ok(
  $$ select public.add_manual_book('M rated', array['Nobody'], null, null, 'reading', current_date, null, 4) $$,
  '22023', 'session_invalid', 'a Rating on a read in progress is refused');
select throws_ok(
  $$ select public.add_manual_book('M dated', array['Nobody'], null, null, 'want_to_read', current_date) $$,
  '22023', 'session_invalid', 'dates on Want to read are refused');
select throws_ok(
  $$ select public.add_manual_book('M no end', array['Nobody'], null, null, 'finished', current_date - 1) $$,
  '22023', 'date_invalid', 'Finished needs its end date');
select throws_ok(
  $$ select public.add_manual_book('M backwards', array['Nobody'], null, null, 'finished', current_date - 1, current_date - 2) $$,
  '22023', 'ended_before_started', 'an end before the start is refused');
select throws_ok(
  $$ select public.add_manual_book('M tomorrow', array['Nobody'], null, null, 'finished', null, current_date + 1) $$,
  '22023', 'date_in_future', 'an end in the future is refused');
select throws_ok(
  $$ select public.add_manual_book('M zero', array['Nobody'], null, null, 'finished', null, current_date, 0) $$,
  '22023', 'rating_invalid', 'a Rating of zero quarters is refused');
select throws_ok(
  $$ select public.add_manual_book('M six', array['Nobody'], null, null, 'finished', null, current_date, 21) $$,
  '22023', 'rating_invalid', 'and so is more than five stars');
select throws_ok(
  $$ select public.add_manual_book('M novel', array['Nobody'], null, null, 'finished', null, current_date, null, repeat('x', 10001)) $$,
  '22023', 'review_too_long', 'a review over 10,000 characters is refused');
select throws_ok(
  $$ select public.add_manual_book('M isbn', array['Nobody'], '0306406153', null, 'finished', null, current_date) $$,
  '22023', 'isbn_invalid', 'a wrong ISBN is still refused first-hand');
select is_empty(
  $$ select 1 from public.books where title like 'M %' $$,
  'and none of those refusals left a Manual book behind');
select throws_ok(
  $$ select public.add_manual_book(null, array['Nobody'], null, null, 'finished', null, current_date) $$,
  '22023', 'book_invalid', 'a Manual book still needs a title');

-- ------------------------------------------------- no way around it, and no way in

select throws_ok(
  $$ select public.add_first_session(gen_random_uuid(), 'reading', current_date, null, null, null) $$,
  '42501', null, 'members cannot call the session helper directly');

select tests.act_as(:'ida_id');
select is(
  (select count(*)::integer from public.reading_sessions s
     join public.library_entries e on e.id = s.entry_id where e.member_id = :'max_id'),
  0, 'Ida cannot see Max''s reads');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  $$ select public.add_to_library('{"title":"Anon","source":"apple","apple_id":"990000000299"}', 'finished', null, current_date) $$,
  '42501', null, 'nobody signed out can add');

select * from finish();
rollback;
