-- The member's own page count for a read (issue #60):
--   supabase test db
--
-- An ebook's pages follow the font size, so a member may set her own total for
-- a Library entry (`library_entries.page_count_override`) through
-- update_progress, in the same call as the page. The page is validated against
-- the total that counts (the override, else the edition's), the total survives
-- every read of the entry, going down cuts the entry's reads back, Change
-- edition clamps against it, and nobody else's entry is touched. Assertions ask
-- about the rows this test made, never about how many rows a table holds.

begin;
select plan(35);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-TOTAL', 'page count test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-TOTAL"}'::jsonb, now(), now(), now());
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

create or replace function tests.session_id(p_entry uuid, p_nth integer default 1)
returns uuid language sql security definer as $$
  select id from (
    select id, row_number() over (order by outcome is null desc, started_on desc nulls last, created_at desc) as n
      from public.reading_sessions where entry_id = p_entry
  ) s where n = p_nth
$$;

select tests.member('ida@total.test') as ida_id \gset
select tests.member('max@total.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida's Library:
--   Dune    300 pages, being read
--   Emma    no page count, being read
--   Ubik    300 pages, read and finished at page 280, now read again
--   Kindred 300 pages, being read, to be moved to another edition
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000006001","page_count":300}',
  'reading', current_date - 6)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000006002"}',
  'reading', current_date - 4)).id as emma \gset
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000006003","page_count":300}',
  'reading', current_date - 20)).id as ubik \gset
select (public.add_to_library('{"title":"Kindred","source":"apple","apple_id":"990000006004","page_count":300}',
  'reading', current_date - 3)).id as kindred \gset
select tests.session_id(:'dune') as dune_s \gset
select tests.session_id(:'kindred') as kindred_s \gset

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000006001","page_count":300}',
  'reading', current_date - 2)).id as max_dune \gset

select tests.act_as(:'ida_id');

-- ------------------------------------------------------------ the default

select is(
  (select page_count_override from public.library_entries where id = :'dune'), null::integer,
  'an entry has no total of its own at first: the edition''s page count counts');
select throws_ok(
  format($$ select public.update_progress(%L, 350, null) $$, :'dune'),
  '22023', 'progress_invalid',
  'a page past the edition''s page count is still refused without a total of her own');

-- -------------------------------------------------- a total with the page

select lives_ok(
  format($$ select public.update_progress(%L, 350, null, true, 420) $$, :'dune'),
  'a member sets her own total and a page past the edition''s in one call');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), 420,
  'the total is kept on the entry');
select is(
  (select progress_page from public.reading_sessions where id = :'dune_s'), 350,
  'and the page, validated against it, on the open read');
select is(
  (select page_count from public.books b join public.library_entries e on e.book_id = b.id where e.id = :'dune'), 300,
  'the edition''s page count itself is untouched');

-- The total stays for the next calls without being sent again.
select lives_ok(
  format($$ select public.update_progress(%L, 400, null) $$, :'dune'),
  'a later update takes pages up to her total without sending it again');
select throws_ok(
  format($$ select public.update_progress(%L, 421, null) $$, :'dune'),
  '22023', 'progress_invalid',
  'and refuses a page past her total');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), 420,
  'an update that leaves the total out does not touch it');

-- A refusal changes nothing, the total included.
select throws_ok(
  format($$ select public.update_progress(%L, 500, null, true, 450) $$, :'dune'),
  '22023', 'progress_invalid',
  'a page past the total sent with it is refused');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), 420,
  'a refused call leaves the total as it was');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null, true, 0) $$, :'dune'),
  '22023', 'progress_invalid', 'a total of 0 is refused');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null, true, -5) $$, :'dune'),
  '22023', 'progress_invalid', 'a negative total is refused');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null, true, 100000) $$, :'dune'),
  '22023', 'progress_invalid', 'a total of 100000 or more is refused');
select throws_ok(
  format($$ select public.update_progress(%L, null, null) $$, :'dune'),
  '22023', 'progress_invalid', 'no value and no total is still refused');
select throws_ok(
  format($$ select public.update_progress(%L, 10, 10, true, 450) $$, :'dune'),
  '22023', 'progress_invalid', 'a page and a percent together are refused, with or without a total');

-- ------------------------------------------------- the total alone, a percent

select lives_ok(
  format($$ select public.update_progress(%L, null, null, true, 450) $$, :'dune'),
  'the total may change on its own');
select results_eq(
  format($$ select page_count_override from public.library_entries where id = %L $$, :'dune'),
  $$ values (450) $$,
  'now 450');
select is(
  (select progress_page from public.reading_sessions where id = :'dune_s'), 400,
  'the read keeps its page when it still fits');
select lives_ok(
  format($$ select public.update_progress(%L, null, 50, true, 600) $$, :'dune'),
  'a percent travels with a total as well');
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where id = %L $$, :'dune_s'),
  $$ values (null::integer, 50::smallint) $$,
  'the percent replaced the page');

-- -------------------------------------------------- going back to the edition's

select lives_ok(
  format($$ select public.update_progress(%L, 200, null, true, null) $$, :'dune'),
  'a null total goes back to the edition''s');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), null::integer,
  'no total of her own again');
select throws_ok(
  format($$ select public.update_progress(%L, 301, null) $$, :'dune'),
  '22023', 'progress_invalid', 'the edition''s page count counts again');

select public.update_progress(:'dune', 10, null, true, 300);
select is(
  (select page_count_override from public.library_entries where id = :'dune'), null::integer,
  'a total that only repeats the edition''s is stored as none');

-- ----------------------------------------------------- an edition without a count

select lives_ok(
  format($$ select public.update_progress(%L, 700, null) $$, :'emma'),
  'without any page count every page is taken');
select lives_ok(
  format($$ select public.update_progress(%L, 120, null, true, 250) $$, :'emma'),
  'a book without a page count may get a total of her own');
select throws_ok(
  format($$ select public.update_progress(%L, 251, null) $$, :'emma'),
  '22023', 'progress_invalid', 'which then limits the page');

-- ------------------------------------------- going down cuts every read of the entry

-- Ubik: a finished read at page 280, then read again with 260 (the total is the entry's).
select public.update_progress(:'ubik', 280, null);
select public.finish_reading(:'ubik', current_date - 10, 14, null);
select public.read_again(:'ubik', current_date - 5);
select public.update_progress(:'ubik', 260, null, true, 290);
select public.update_progress(:'ubik', null, null, true, 200);
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L order by outcome is null $$, :'ubik'),
  $$ values (200), (200) $$,
  'a lower total cuts the closed read and the open one back to it');
select public.update_progress(:'ubik', null, null, true, 290);
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L order by outcome is null $$, :'ubik'),
  $$ values (200), (200) $$,
  'a higher total does not bring the old pages back');

-- ---------------------------------------------------------- Change edition

select public.update_progress(:'kindred', 400, null, true, 500);
select public.change_edition(:'kindred',
  '{"title":"Kindred","source":"apple","apple_id":"990000006005","page_count":320}');
select results_eq(
  format($$ select page_count_override, (select progress_page from public.reading_sessions where id = %L) from public.library_entries where id = %L $$, :'kindred_s', :'kindred'),
  $$ values (500, 400) $$,
  'Change edition keeps her total and clamps against it, not the new edition''s 320');
select public.update_progress(:'kindred', 420, null, true, 420);
select public.change_edition(:'kindred',
  '{"title":"Kindred","source":"apple","apple_id":"990000006006","page_count":300}');
select results_eq(
  format($$ select page_count_override, (select progress_page from public.reading_sessions where id = %L) from public.library_entries where id = %L $$, :'kindred_s', :'kindred'),
  $$ values (420, 420) $$,
  'a page held at her total stays within it after the move');

-- ------------------------------------------------------------- not hers

select throws_ok(
  format($$ select public.update_progress(%L, 10, null, true, 400) $$, :'max_dune'),
  'P0002', 'entry_not_found', 'another member''s entry is not found, total or not');
select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.update_progress(%L, 10, null, true, 400) $$, :'dune'),
  'P0002', 'entry_not_found', 'and Ida''s entry is not Max''s to touch');
select is(
  (select page_count_override from public.library_entries where id = :'max_dune'), null::integer,
  'Max''s own entry kept no total from Ida''s');

select * from finish();
rollback;
