-- Progress by day (issue #68):
--   supabase test db
--
-- Every progress update also books the day it belongs to, in the same call:
-- where the read was before the day's first update and after its last, on the
-- member's own calendar day (sent by the app, within a day of the server's UTC
-- date). A day that ends where it started has no row (an Undo), the total alone
-- books nothing, a day never goes back before the read's last one, and members
-- read only their own days and write none directly. Assertions ask about the
-- rows this test made, never about how many rows a table holds.

begin;
select plan(35);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-DAYS', 'progress days test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-DAYS"}'::jsonb, now(), now(), now());
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

create or replace function tests.open_session(p_entry uuid)
returns uuid language sql security definer as $$
  select id from public.reading_sessions where entry_id = p_entry and outcome is null
$$;

-- The day as stored (start, end), for one read and one day: "120-145", "-30" (no start), "%40-%55".
create or replace function tests.day_of(p_session uuid, p_day date)
returns text language sql security definer as $$
  select coalesce(start_page::text, '%' || start_percent::text, '') || '-' || coalesce(end_page::text, '%' || end_percent::text)
    from public.reading_progress_days where session_id = p_session and day = p_day
$$;

select tests.member('ida@days.test') as ida_id \gset
select tests.member('max@days.test') as max_id \gset
select (now() at time zone 'utc')::date as today \gset
select ((now() at time zone 'utc')::date + 1)::date as tomorrow \gset
select ((now() at time zone 'utc')::date - 1)::date as yesterday \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida reads Dune (300 pages, begun a week ago), Emma (no page count) and Kindred
-- (begun today); Max reads his own Dune.
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000068001","page_count":300}',
  'reading', current_date - 6)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000068002"}',
  'reading', current_date - 4)).id as emma \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000068003","page_count":300}',
  'reading', :'yesterday'::date)).id as kindred \gset
select tests.open_session(:'dune') as dune_s \gset
select tests.open_session(:'emma') as emma_s \gset
select tests.open_session(:'kindred') as kindred_s \gset

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000068001","page_count":300}',
  'reading', current_date - 2)).id as max_dune \gset
select tests.open_session(:'max_dune') as max_s \gset

select tests.act_as(:'ida_id');

-- ----------------------------------------------------------- one day, its moves

select lives_ok(
  format($$ select public.update_progress(%L, 20, null, p_day => %L) $$, :'kindred', :'today'),
  'the first update of a read begun the day before');
select is(tests.day_of(:'kindred_s', :'today'), '-20',
  'books her day, from no progress (none: 0) to page 20');

select lives_ok(
  format($$ select public.update_progress(%L, 30, null, p_day => %L) $$, :'dune', :'yesterday'),
  'the first update of a read begun a week ago');
select is(tests.day_of(:'dune_s', :'yesterday'), null,
  'books no day: page 30 is where the read already was, not a day''s reading');
select lives_ok(
  format($$ select public.update_progress(%L, 55, null, p_day => %L) $$, :'dune', :'yesterday'),
  'a second update on the same day');
select is(tests.day_of(:'dune_s', :'yesterday'), '30-55',
  'counts from there');
select lives_ok(
  format($$ select public.update_progress(%L, 60, null, p_day => %L) $$, :'dune', :'yesterday'),
  'a third');
select is(tests.day_of(:'dune_s', :'yesterday'), '30-60',
  'moves the day''s end; its start stays where the day began');

select lives_ok(
  format($$ select public.update_progress(%L, 80, null, p_day => %L) $$, :'dune', :'today'),
  'an update on the next day');
select is(tests.day_of(:'dune_s', :'today'), '60-80',
  'starts a new day where the last one ended');
select is(tests.day_of(:'dune_s', :'yesterday'), '30-60',
  'and leaves the day before as it was');

-- Undo: back to where the day started, so the day read nothing.
select lives_ok(
  format($$ select public.update_progress(%L, 60, null, p_day => %L) $$, :'dune', :'today'),
  'an Undo sets the value from before again');
select is(tests.day_of(:'dune_s', :'today'), null,
  'a day that ends where it started has no row');
select is((select progress_page from public.reading_sessions where id = :'dune_s'), 60,
  'and the read is back where it was');

-- A correction downwards within a day is just a smaller day.
select lives_ok(
  format($$ select public.update_progress(%L, 90, null, p_day => %L) $$, :'dune', :'today'),
  'page 90 today');
select lives_ok(
  format($$ select public.update_progress(%L, 70, null, p_day => %L) $$, :'dune', :'today'),
  'then corrected to 70 the same day');
select is(tests.day_of(:'dune_s', :'today'), '60-70',
  'the day runs from where it started to the correction');

-- ------------------------------------------------------------- whose day it is

select is(tests.day_of(:'dune_s', :'yesterday'), '30-60', '(yesterday is still booked)');
select lives_ok(
  format($$ select public.update_progress(%L, 75, null, p_day => %L) $$, :'dune', :'yesterday'),
  'a day before the read''s last recorded one (a phone that crossed time zones)');
select is(tests.day_of(:'dune_s', :'today'), '60-75',
  'is booked on that last day, so the days only move forward');
select is(tests.day_of(:'dune_s', :'yesterday'), '30-60',
  'and the earlier day is not rewritten');

select throws_ok(
  format($$ select public.update_progress(%L, 76, null, p_day => %L) $$, :'dune', (:'today'::date + 2)::text),
  '22023', 'date_invalid',
  'a day no time zone has now is refused');
select throws_ok(
  format($$ select public.update_progress(%L, 76, null, p_day => %L) $$, :'dune', (:'today'::date - 2)::text),
  '22023', 'date_invalid',
  'two days back is refused too');
select is((select progress_page from public.reading_sessions where id = :'dune_s'), 75,
  'a refused day changes nothing');

select lives_ok(
  format($$ select public.update_progress(%L, 78, null) $$, :'dune'),
  'a call without a day (from before #68) still works');
select ok(tests.day_of(:'dune_s', :'today') = '60-78' or tests.day_of(:'dune_s', :'tomorrow') = '75-78',
  'and books the server''s UTC date (or the read''s later last day)');

-- ------------------------------------------------- the total alone, percent

select lives_ok(
  format($$ select public.update_progress(%L, null, null, true, 320, p_day => %L) $$, :'emma', :'today'),
  'the total alone (Emma gets a page count)');
select is(tests.day_of(:'emma_s', :'today'), null,
  'books no day: nothing was read');
select lives_ok(
  format($$ select public.update_progress(%L, null, 40, p_day => %L) $$, :'emma', :'today'),
  'a percent (where the read already was)');
select lives_ok(
  format($$ select public.update_progress(%L, null, 52, p_day => %L) $$, :'emma', :'today'),
  'and more of it');
select is(tests.day_of(:'emma_s', :'today'), '%40-%52',
  'is booked as a percent');

-- -------------------------------------------------- whose days, and how

select tests.act_as(:'max_id');
select is_empty(
  format($$ select 1 from public.reading_progress_days where session_id = %L $$, :'dune_s'),
  'another member does not see her days');
select throws_ok(
  format($$ insert into public.reading_progress_days (session_id, day, end_page) values (%L, %L, 10) $$, :'max_s', :'today'),
  '42501', null,
  'members write no days directly, not even on their own read');

select tests.act_as(:'ida_id');
select lives_ok(
  format($$ select public.finish_reading(%L, current_date, null, null) $$, :'dune'),
  'finishing the read');
select is(tests.day_of(:'dune_s', :'yesterday'), '30-60',
  'keeps its days');

select * from finish();
rollback;
