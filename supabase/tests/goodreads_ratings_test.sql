-- Goodreads' rating by ISBN-13, the cache behind the book page's line (issue #69):
--   supabase test db
--
-- `goodreads_ratings` is shared like the Catalogue: every member reads it, only
-- the service role (the goodreads-rating edge function) writes it. A found row
-- has what the page shows, a miss nothing but its time. A Catalogue Book finds
-- its found rating by its ISBN (`goodreads_rating(library_entries)`, on the entry: the books row cannot
-- be passed whole while its description is withheld), never a miss.
-- Assertions ask about the rows this test made, never about how many rows a
-- table holds.

begin;
select plan(22);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GOODREADS', 'goodreads test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GOODREADS"}'::jsonb, now(), now(), now());
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

select tests.member('ida@goodreads.test') as ida_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Two ISBNs no real Book has (979-8-99…): one Goodreads knows, one it does not.
-- And two Catalogue Books with them, plus one without an ISBN.
insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
values ('9798991234566', 'found', 'isbn', '6388978', 4.32, 137875, 6116),
       ('9798991234573', 'not_found', null, null, null, null, null);

insert into public.books (title, authors, isbn13, source, apple_id) values
  ('Rated Book', '{Ann Author}', '9798991234566', 'apple', '990000000001'),
  ('Unknown Book', '{Ann Author}', '9798991234573', 'apple', '990000000002'),
  ('No ISBN Book', '{Ann Author}', null, 'apple', '990000000003');

insert into public.library_entries (member_id, book_id)
select :'ida_id'::uuid, id from public.books where title in ('Rated Book', 'Unknown Book', 'No ISBN Book');

-- -------------------------------------------------------------------- shape

select has_table('public', 'goodreads_ratings', 'the cache exists');
select col_is_pk('public', 'goodreads_ratings', 'isbn13', 'keyed by ISBN-13');
select col_type_is('public', 'goodreads_ratings', 'rating', 'numeric(3,2)', 'the rating has two decimals');
select has_index('public', 'goodreads_ratings', 'goodreads_ratings_goodreads_id', 'found by Goodreads id too');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.goodreads_ratings'::regclass),
  'row level security is on');

-- ------------------------------------------------------------- constraints

select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status) values ('0061803200', 'not_found') $$,
  '23514', null, 'only an ISBN-13 is a key');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, matched_by) values ('9781111111113', 'found', 'isbn') $$,
  '23514', null, 'a found row without its figures is refused');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, goodreads_id) values ('9781111111113', 'not_found', '1') $$,
  '23514', null, 'a miss with figures is refused');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count)
     values ('9781111111113', 'found', 'isbn', '1', 5.5, 3) $$,
  '23514', null, 'a rating above 5 is refused');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status) values ('9781111111113', 'error') $$,
  '23514', null, 'a failure is never stored');

-- ----------------------------------------------------------- a Book's rating

select results_eq(
  $$ select g.goodreads_id, g.rating, g.ratings_count, g.reviews_count
       from public.library_entries e join public.books b on b.id = e.book_id, public.goodreads_rating(e) g where b.title = 'Rated Book' $$,
  $$ values ('6388978'::text, 4.32::numeric(3,2), 137875, 6116) $$,
  'a Library entry finds its Book''s rating by its ISBN');
select is_empty(
  $$ select 1 from public.library_entries e join public.books b on b.id = e.book_id, public.goodreads_rating(e) g where b.title = 'Unknown Book' $$,
  'a miss is no rating');
select is_empty(
  $$ select 1 from public.library_entries e join public.books b on b.id = e.book_id, public.goodreads_rating(e) g where b.title = 'No ISBN Book' $$,
  'a Book without an ISBN has none');

-- ------------------------------------------------------------------- members

select tests.act_as(:'ida_id');

select set_eq(
  $$ select isbn13, status from public.goodreads_ratings where isbn13 in ('9798991234566', '9798991234573') $$,
  $$ values ('9798991234566', 'found'), ('9798991234573', 'not_found') $$,
  'a member reads the cache, misses included');
select is(
  (select g.goodreads_id from public.library_entries e join public.books b on b.id = e.book_id, public.goodreads_rating(e) g
    where b.title = 'Rated Book'),
  '6388978',
  'and the rating of her entry''s Book through it');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status) values ('9798991234580', 'not_found') $$,
  '42501', null, 'a member cannot add to the cache');
select throws_ok(
  $$ update public.goodreads_ratings set rating = 1 where isbn13 = '9798991234566' $$,
  '42501', null, 'nor change it');
select throws_ok(
  $$ delete from public.goodreads_ratings where isbn13 = '9798991234566' $$,
  '42501', null, 'nor empty it');

reset role;

-- ------------------------------------------------------------------ visitors

set local role anon;

select throws_ok(
  $$ select 1 from public.goodreads_ratings $$,
  '42501', null, 'a visitor cannot read the cache');

reset role;

-- ------------------------------------------------------- the edge function

set local role service_role;

select lives_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
     values ('9798991234580', 'found', 'title', '32109569', 4.24, 146833, null)
     on conflict (isbn13) do update set status = excluded.status $$,
  'the service role stores a rating found by title, without a review count');
select lives_ok(
  $$ update public.goodreads_ratings
        set status = 'found', matched_by = 'isbn', goodreads_id = '1', rating = 3, ratings_count = 2,
            checked_at = now()
      where isbn13 = '9798991234573' $$,
  'and refreshes a miss that Goodreads now knows');

reset role;

select is(
  (select ratings_count from public.goodreads_ratings where isbn13 = '9798991234573'),
  2,
  'the refresh is stored');

select * from finish();
rollback;
