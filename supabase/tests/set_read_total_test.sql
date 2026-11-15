-- The member's own page count on a finished read (`set_read_total`):
--   supabase test db
--
-- `update_progress` refuses a finished entry (`not_reading`), so a read that
-- ended without a count could never get one. `set_read_total` sets only
-- `library_entries.page_count_override`, on any entry of hers including a
-- finished one, and never rewrites recorded history: a lower total leaves the
-- reads' pages exactly as they were. Assertions ask about the rows this test
-- made, never about how many rows a table holds.

begin;
select plan(18);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-TOTAL2', 'read total test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-TOTAL2"}'::jsonb, now(), now(), now());
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

select tests.member('ida@total2.test') as ida_id \gset
select tests.member('max@total2.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida's Library:
--   Dune  300 pages, read and finished at page 280
--   Emma  no page count, read and finished at page 250
select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000006011","page_count":300}',
  'reading', current_date - 20)).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000006012"}',
  'reading', current_date - 18)).id as emma \gset
select public.update_progress(:'dune', 280, null);
select public.finish_reading(:'dune', current_date - 10, 16, null);
select public.update_progress(:'emma', 250, null);
select public.finish_reading(:'emma', current_date - 8, null, null);

select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000006011","page_count":300}',
  'reading', current_date - 2)).id as max_dune \gset

select tests.act_as(:'ida_id');

-- ------------------------------------------------- the point: a finished read

select lives_ok(
  format($$ select public.set_read_total(%L, 420) $$, :'dune'),
  'her own total is set on a finished entry');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), 420,
  'the total is kept on the entry');
select is(
  (select coalesce(e.page_count_override, b.page_count)
     from public.library_entries e join public.books b on b.id = e.book_id where e.id = :'dune'), 420,
  'the page count that counts (pageCountOf) sees it, so the read leaves pagesMissing');

-- --------------------------------------- a lower total keeps the history

select lives_ok(
  format($$ select public.set_read_total(%L, 100) $$, :'dune'),
  'a total below the recorded pages is taken');
select is(
  (select progress_page from public.reading_sessions where entry_id = :'dune'), 280,
  'the finished read keeps its recorded pages: history is never rewritten');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), 100,
  'and the lower total stands');

-- ----------------------------------------------- back to the edition's

select lives_ok(
  format($$ select public.set_read_total(%L, 300) $$, :'dune'),
  'a total that only repeats the edition''s is taken');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), null::integer,
  'it is stored as no override');
select lives_ok(
  format($$ select public.set_read_total(%L, 450) $$, :'dune'),
  'a total of her own again');
select lives_ok(
  format($$ select public.set_read_total(%L, null) $$, :'dune'),
  'null goes back to the edition''s');
select is(
  (select page_count_override from public.library_entries where id = :'dune'), null::integer,
  'no total of her own again');
select is(
  (select coalesce(e.page_count_override, b.page_count)
     from public.library_entries e join public.books b on b.id = e.book_id where e.id = :'dune'), 300,
  'the edition''s page count counts again');

-- ------------------------------------------ a book without any count

select lives_ok(
  format($$ select public.set_read_total(%L, 250) $$, :'emma'),
  'a book without a page count gets a total of her own');
select is(
  (select coalesce(e.page_count_override, b.page_count)
     from public.library_entries e join public.books b on b.id = e.book_id where e.id = :'emma'), 250,
  'so the finished read has a page count that counts');

-- ------------------------------------------------------------- not hers

select tests.act_as(:'max_id');
select throws_ok(
  format($$ select public.set_read_total(%L, 400) $$, :'dune'),
  'P0002', 'entry_not_found', 'another member''s entry is not found');
select lives_ok(
  format($$ select public.set_read_total(%L, 400) $$, :'max_dune'),
  'her own entry takes a total');

-- -------------------------------------------------------------- refused

select tests.act_as(:'ida_id');
select throws_ok(
  format($$ select public.set_read_total(%L, 0) $$, :'dune'),
  '22023', 'progress_invalid', 'a total of 0 is refused');
select throws_ok(
  format($$ select public.set_read_total(%L, 100000) $$, :'dune'),
  '22023', 'progress_invalid', 'a total of 100000 or more is refused');

select * from finish();
rollback;
