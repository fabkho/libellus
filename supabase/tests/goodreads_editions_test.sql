-- The edition cache behind the Goodreads import (issue #111):
--   supabase test db
--
-- `goodreads_editions` is the goodreads-rating edge function's own cache, not
-- shared like the Catalogue: only the service role reads and writes it, and a
-- member reaches it only through the function's answer. A found row says what
-- the edition is, a miss nothing but its time. Assertions ask about the rows
-- this test made, never about how many rows a table holds.

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GREDITIONS', 'goodreads editions test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GREDITIONS"}'::jsonb, now(), now(), now());
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

select tests.member('ida@editions.test') as ida_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- The Kindle edition of Small Gods, which a Goodreads export names without an
-- ISBN, and a Book Id Goodreads shows nothing for.
insert into public.goodreads_editions
  (goodreads_id, status, title, isbn13, isbn10, asin, language, page_count, format, publisher, published_year)
values ('6388978', 'found', 'Small Gods', '9780061803208', '0061803200', 'B000QTEA3I', 'en', 26,
        'Kindle Edition', 'HarperCollins ebooks', 2009),
       ('1111111', 'not_found', null, null, null, null, null, null, null, null, null);

-- -------------------------------------------------------------------- shape

select has_table('public', 'goodreads_editions', 'the edition cache exists');
select col_is_pk('public', 'goodreads_editions', 'goodreads_id', 'keyed by the Goodreads Book Id');
select col_type_is('public', 'goodreads_editions', 'published_year', 'smallint', 'a year is a small number');
select has_index('public', 'goodreads_editions', 'goodreads_editions_isbn13', 'found by ISBN-13 too');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.goodreads_editions'::regclass),
  'row level security is on');

-- ------------------------------------------------------------- constraints

select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status) values ('kca://book/x', 'not_found') $$,
  '23514', null, 'only a Goodreads Book Id is a key');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status) values ('2222222', 'error') $$,
  '23514', null, 'a failure is never stored');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, isbn13) values ('2222222', 'found', '0061803200') $$,
  '23514', null, 'an ISBN-10 is not an ISBN-13');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, isbn10) values ('2222222', 'found', '006180320') $$,
  '23514', null, 'nor is a nine-digit number an ISBN-10');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, page_count) values ('2222222', 'found', 0) $$,
  '23514', null, 'a book of no pages is refused');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, title) values ('2222222', 'not_found', 'Small Gods') $$,
  '23514', null, 'a miss that knows a title is refused');
select lives_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, title, asin, format)
     values ('2222222', 'found', 'Kindle Only', 'B000QTEA3I', 'Kindle Edition') $$,
  'an edition without any ISBN is stored: that is why the import asks');

-- ------------------------------------------------------------------- members

select tests.act_as(:'ida_id');

select throws_ok(
  $$ select 1 from public.goodreads_editions $$,
  '42501', null, 'a member does not read the edition cache, only the function''s answer');
select throws_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status) values ('3333333', 'not_found') $$,
  '42501', null, 'nor adds to it');
select throws_ok(
  $$ update public.goodreads_editions set title = 'Mine' where goodreads_id = '6388978' $$,
  '42501', null, 'nor changes it');
select throws_ok(
  $$ delete from public.goodreads_editions where goodreads_id = '6388978' $$,
  '42501', null, 'nor empties it');

reset role;

-- ------------------------------------------------------------------ visitors

set local role anon;

select throws_ok(
  $$ select 1 from public.goodreads_editions $$,
  '42501', null, 'a visitor cannot read it either');

reset role;

-- ------------------------------------------------------- the edge function

set local role service_role;

select results_eq(
  $$ select isbn13, isbn10, asin, language, page_count, published_year
       from public.goodreads_editions where goodreads_id = '6388978' $$,
  $$ values ('9780061803208'::text, '0061803200'::text, 'B000QTEA3I'::text, 'en'::text, 26, 2009::smallint) $$,
  'the edge function reads the edition it stored');
select lives_ok(
  $$ insert into public.goodreads_editions (goodreads_id, status, title, isbn13, format, published_year)
     values ('6388978', 'found', 'Small Gods', '9780061803208', 'Paperback', 1992)
     on conflict (goodreads_id) do update
        set format = excluded.format, published_year = excluded.published_year, checked_at = now() $$,
  'and refreshes an edition after ninety days');
select lives_ok(
  $$ update public.goodreads_editions
        set status = 'found', title = 'Found At Last', checked_at = now()
      where goodreads_id = '1111111' $$,
  'and a miss Goodreads now shows');

reset role;

select is(
  (select format from public.goodreads_editions where goodreads_id = '6388978'),
  'Paperback',
  'the refresh is stored');

select * from finish();
rollback;
