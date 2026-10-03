-- Reading progress at the database boundary (issue #39):
--   supabase test db
--
-- While a Book is Currently reading, the member sets a page or a percent on the
-- open read with update_progress: exactly one of the two, a page within the
-- edition's page count when it has one, only on an open read. Only the latest
-- value is kept; finishing or abandoning keeps it on the closed read; reading
-- again starts with none. The page-count rule a later edition change reuses
-- (progress_page_fits, clamp_progress_page, clamp_session_progress) is covered
-- here too. Members act through their JWT claims and only on their own entries.
-- Assertions ask about the rows this test made, never about how many rows a
-- table holds.

begin;
select plan(50);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-PROGRESS', 'progress test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-PROGRESS"}'::jsonb, now(), now(), now());
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

-- The open or latest read of an entry, past the members' own RLS.
create or replace function tests.session_id(p_entry uuid, p_nth integer default 1)
returns uuid language sql security definer as $$
  select id from (
    select id, row_number() over (order by outcome is null desc, started_on desc nulls last, created_at desc) as n
      from public.reading_sessions where entry_id = p_entry
  ) s where n = p_nth
$$;

select tests.member('ida@progress.test') as ida_id \gset
select tests.member('max@progress.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida's Library:
--   Dune      300 pages, being read
--   Emma      no page count, being read
--   Ubik      300 pages, being read, then abandoned
--   Kindred   300 pages, read, then read again
--   Solaris   Want to read
--   Hyperion  finished
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000003101","page_count":300}',
  'reading', current_date - 6)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000003102"}',
  'reading', current_date - 4)).id as emma \gset
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000003103","page_count":300}',
  'reading', current_date - 9)).id as ubik \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000003104","page_count":300}',
  'finished', current_date - 90, current_date - 80, 12, null)).id as kindred \gset
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000003105"}')).id as solaris \gset
select (public.add_to_library('{"title":"Hyperion","source":"apple","apple_id":"990000003106","page_count":300}',
  'finished', current_date - 60, current_date - 55, 8, null)).id as hyperion \gset

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000003101","page_count":300}',
  'reading', current_date - 2)).id as max_dune \gset

select tests.act_as(:'ida_id');
select tests.session_id(:'dune') as dune_s \gset
select tests.session_id(:'emma') as emma_s \gset
select tests.session_id(:'ubik') as ubik_s \gset
select tests.session_id(:'max_dune') as max_s \gset

-- ------------------------------------------------------------ a fresh read

select results_eq(
  format($$ select progress_page, progress_percent, progress_updated_at from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (null::integer, null::smallint, null::timestamptz) $$,
  'a read starts with no progress');

-- ------------------------------------------------------------- update_progress

select lives_ok(
  format($$ select public.update_progress(%L, 120, null) $$, :'dune'),
  'a member sets the page she is on');
select results_eq(
  format($$ select progress_page, progress_percent, progress_updated_at is not null from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (120, null::smallint, true) $$,
  'the open read holds the page and when it was set');
select is(
  (select progress_page from public.update_progress(:'dune', 212, null)), 212,
  'the function returns the read, with the new page');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L $$, :'dune'),
  $$ values (212) $$,
  'only the latest value is kept: still one read, one value');

select lives_ok(
  format($$ select public.update_progress(%L, 40, null) $$, :'dune'),
  'progress may go back (a re-read page, a corrected number)');
select lives_ok(
  format($$ select public.update_progress(%L, 0, null) $$, :'dune'),
  'page 0 is allowed: started, not yet turned a page');
select lives_ok(
  format($$ select public.update_progress(%L, 300, null) $$, :'dune'),
  'the last page is allowed');
select results_eq(
  format($$ select progress_page from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (300) $$,
  'stored as the last page');

-- A percent replaces the page, and the other way round.
select lives_ok(
  format($$ select public.update_progress(%L, null, 45) $$, :'dune'),
  'a member switches to a percentage');
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (null::integer, 45::smallint) $$,
  'the percent replaced the page: one of the two, never both');
select lives_ok(
  format($$ select public.update_progress(%L, null, 0) $$, :'dune'),
  '0 % is allowed');
select lives_ok(
  format($$ select public.update_progress(%L, null, 100) $$, :'dune'),
  '100 % is allowed');
select lives_ok(
  format($$ select public.update_progress(%L, 77, null) $$, :'dune'),
  'and back to a page');
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (77, null::smallint) $$,
  'the page replaced the percent');

-- A book without a page count: percent, and a page has no bound to be held to.
select lives_ok(
  format($$ select public.update_progress(%L, null, 30) $$, :'emma'),
  'a Book without a page count takes a percentage');
select lives_ok(
  format($$ select public.update_progress(%L, 51, null) $$, :'emma'),
  'and a page when one is given: nothing to hold it to');

-- ------------------------------------------------------------------ refusals

select throws_ok(
  format($$ select public.update_progress(%L, 301, null) $$, :'dune'),
  '22023', 'progress_invalid', 'a page past the page count is refused');
select throws_ok(
  format($$ select public.update_progress(%L, -1, null) $$, :'dune'),
  '22023', 'progress_invalid', 'a negative page is refused');
select throws_ok(
  format($$ select public.update_progress(%L, null, 101) $$, :'dune'),
  '22023', 'progress_invalid', 'a percent over 100 is refused');
select throws_ok(
  format($$ select public.update_progress(%L, null, -1) $$, :'dune'),
  '22023', 'progress_invalid', 'a negative percent is refused');
select throws_ok(
  format($$ select public.update_progress(%L, 10, 10) $$, :'dune'),
  '22023', 'progress_invalid', 'a page and a percent together are refused');
select throws_ok(
  format($$ select public.update_progress(%L, null, null) $$, :'dune'),
  '22023', 'progress_invalid', 'neither is refused: progress is set, not cleared');
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (77, null::smallint) $$,
  'after all those refusals the read has the last good value');

select throws_ok(
  format($$ select public.update_progress(%L, 10, null) $$, :'solaris'),
  '22023', 'not_reading', 'a Want to read entry has no open read to record progress on');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null) $$, :'hyperion'),
  '22023', 'not_reading', 'nor has a finished one');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null) $$, gen_random_uuid()),
  'P0002', 'entry_not_found', 'an entry that does not exist is not found');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null) $$, :'max_dune'),
  'P0002', 'entry_not_found', 'another member''s entry is not found either, never forbidden');
select tests.act_as(:'max_id');
select is(
  (select progress_page from public.reading_sessions where id = :'max_s'), null::integer,
  'and Max''s read was not touched');
select tests.act_as(:'ida_id');

-- ------------------------------------------- the table's own checks (no RPC)

reset role;
select throws_ok(
  format($$ update public.reading_sessions set progress_page = 5, progress_percent = 5, progress_updated_at = now() where id = %L $$, :'ubik_s'),
  '23514', null, 'the table refuses a page and a percent together, whoever writes');
select throws_ok(
  format($$ update public.reading_sessions set progress_page = 5 where id = %L $$, :'ubik_s'),
  '23514', null, 'and a value without the time it was set');
select throws_ok(
  format($$ update public.reading_sessions set progress_updated_at = now() where id = %L $$, :'ubik_s'),
  '23514', null, 'and a time without a value');
select tests.act_as(:'ida_id');

-- ------------------------------------------- finishing and abandoning keep it

select public.update_progress(:'ubik', 150, null);
select public.abandon_reading(:'ubik', current_date - 1, 'Too strange.');
select results_eq(
  format($$ select outcome::text, progress_page from public.reading_sessions where id = %L $$, :'ubik_s'),
  $$ values ('abandoned', 150) $$,
  'abandoning keeps the last page on the closed read');
select throws_ok(
  format($$ select public.update_progress(%L, 160, null) $$, :'ubik'),
  '22023', 'not_reading', 'and the closed read takes no more');

select public.update_progress(:'dune', null, 90);
select public.finish_reading(:'dune', current_date, 18, null);
select results_eq(
  format($$ select outcome::text, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values ('finished', 90::smallint) $$,
  'finishing keeps the last percent on the closed read');

-- ------------------------------------------------------------- Read again

-- Kindred: a first read logged as finished (no progress), then read again.
select tests.session_id(:'kindred') as kindred_first \gset
select public.read_again(:'kindred', current_date - 3);
select tests.session_id(:'kindred') as kindred_second \gset
select public.update_progress(:'kindred', 10, null);
select public.finish_reading(:'kindred', current_date - 2);
select public.read_again(:'kindred', current_date - 1);
select public.update_progress(:'kindred', 25, null);
select results_eq(
  format($$ select progress_page from public.reading_sessions where id in (%L, %L) order by progress_page nulls first $$, :'kindred_first', :'kindred_second'),
  $$ values (null::integer), (10) $$,
  'each read has its own value: the first none, the second kept its 10');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L and outcome is null $$, :'kindred'),
  $$ values (25) $$,
  'the new read holds its own page');
select public.finish_reading(:'kindred', current_date);
select public.read_again(:'kindred', current_date);
select results_eq(
  format($$ select progress_page, progress_percent, progress_updated_at from public.reading_sessions where entry_id = %L and outcome is null $$, :'kindred'),
  $$ values (null::integer, null::smallint, null::timestamptz) $$,
  'Read again starts with no progress, whatever the read before it reached');

-- ------------------------------------------------------------ the page rule

select is(public.progress_page_fits(300, 300), true, 'the last page fits');
select is(public.progress_page_fits(301, 300), false, 'one past it does not');
select is(public.progress_page_fits(-1, 300), false, 'a negative page never fits');
select is(public.progress_page_fits(5000, null), true, 'any page fits a Book without a page count');
select is(public.clamp_progress_page(400, 300), 300, 'a page past the page count is cut back to the last page');
select is(public.clamp_progress_page(120, 300), 120, 'a page within it is as it was');
select is(public.clamp_progress_page(null, 300), null::integer, 'no page stays none (a percent is never touched)');
select is(public.clamp_progress_page(400, null), 400, 'no page count, nothing to clamp to');

-- clamp_session_progress: for the actions that change an entry's Book, not for members.
select throws_ok(
  format($$ select public.clamp_session_progress(%L, 100) $$, :'ubik'),
  '42501', null, 'a member cannot call the clamp herself');

reset role;
select public.clamp_session_progress(:'ubik', 100);
select results_eq(
  format($$ select progress_page from public.reading_sessions where id = %L $$, :'ubik_s'),
  $$ values (100) $$,
  'the clamp cuts a closed read''s page back to the new page count too');
select public.clamp_session_progress(:'ubik', 200);
select public.clamp_session_progress(:'ubik', null);
select results_eq(
  format($$ select progress_page from public.reading_sessions where id = %L $$, :'ubik_s'),
  $$ values (100) $$,
  'a larger page count, or none, leaves it as it is');
select public.clamp_session_progress(:'dune', 10);
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (null::integer, 90::smallint) $$,
  'a percent is never clamped');

select * from finish();
rollback;
