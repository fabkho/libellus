-- Google Books as a book source (issue #305): supabase test db
--
--   * the answer cache is service role only, refuses a row that lives past a day and a row that is not what it says it is
--   * the daily budget counts one request per take, refuses past its limit without counting, and is the service role's alone
--   * the purge deletes what expired (and a month-old counter), keeps what has not, and is no member's to call
--   * a Catalogue Book's genre may come from `google`
--   * Google's cover address is allowed (the image path only, the host exactly), never shown outside the app and
--     never stored: the cover store's queue and the owner's status leave it out
--
-- Assertions ask about the rows this test made, never about how many rows a table holds.

begin;
select plan(56);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GOOGLE-BOOKS', 'google books test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GOOGLE-BOOKS"}'::jsonb, now(), now(), now());
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

create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;

select tests.member('ida@google-books.test') as ida_id \gset

grant usage on schema tests to authenticated, service_role, anon;
grant execute on all functions in schema tests to authenticated, service_role, anon;

-- -------------------------------------------------------------------- shape

select has_table('public', 'google_books_cache', 'the cache exists');
select col_is_pk('public', 'google_books_cache', 'cache_key', 'keyed by the question');
select has_table('public', 'google_books_budget', 'the budget exists');
select col_is_pk('public', 'google_books_budget', 'day', 'one row a day');
select ok((select relrowsecurity from pg_class where oid = 'public.google_books_cache'::regclass), 'row level security is on (cache)');
select ok((select relrowsecurity from pg_class where oid = 'public.google_books_budget'::regclass), 'row level security is on (budget)');
select is(
  (select count(*)::int from pg_policies where tablename in ('google_books_cache', 'google_books_budget')),
  0, 'and no policy opens either table to a member');
select has_index('public', 'google_books_cache', 'google_books_cache_expires', 'the purge finds expired rows by an index');

-- ------------------------------------------------------- the service role

select tests.act_as_service();

select lives_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('isbn:9791034567898', 'found', '[{"id":"a","title":"T"}]', now(), now() + interval '1 hour') $$,
  'the function writes a found answer');
select lives_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('isbn:9791034567997', 'not_found', '[]', now(), now() + interval '6 hours') $$,
  'and a miss');
select lives_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('title:der stille hafen|ida beispiel|de', 'found', '[{"id":"b"}]', now(), now() + interval '1 day') $$,
  'a title key, for as long as a day');
select lives_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('q:stille hafen|', 'found', '[{"id":"c"}]', now(), now() + interval '10 minutes') $$,
  'a free-words key');
select is((select count(*)::int from public.google_books_cache where cache_key like 'isbn:97910345678%' or cache_key like 'isbn:97910345679%'), 2, 'the function reads them back');
select lives_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('isbn:9791034567898', 'found', '[{"id":"a2"}]', now(), now() + interval '2 hours')
     on conflict (cache_key) do update set volumes = excluded.volumes, expires_at = excluded.expires_at $$,
  'an answer is refreshed in place (upsert)');

-- ------------------------------------------------------------- constraints

select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('9791034567898', 'not_found', '[]', now() + interval '1 hour') $$,
  '23514', null, 'a key that is no question is refused');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('isbn:0061803200', 'not_found', '[]', now() + interval '1 hour') $$,
  '23514', null, 'only an ISBN-13 keys an ISBN');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('isbn:9791034567805', 'found', '[]', now() + interval '1 hour') $$,
  '23514', null, 'a found row without volumes is refused');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('isbn:9791034567812', 'not_found', '[{"id":"a"}]', now() + interval '1 hour') $$,
  '23514', null, 'a miss with volumes is refused');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('isbn:9791034567829', 'found', '{"id":"a"}', now() + interval '1 hour') $$,
  '23514', null, 'volumes are a list');
select throws_ok(
  format($$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('isbn:9791034567836', 'found', %L, now() + interval '1 hour') $$,
         (select jsonb_agg(jsonb_build_object('id', i)) from generate_series(1, 21) i)),
  '23514', null, 'and at most twenty');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('isbn:9791034567843', 'found', '[{"id":"a"}]', now(), now() + interval '25 hours') $$,
  '23514', null, 'a copy that would live past a day is refused (the terms allow no permanent copy)');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
     values ('isbn:9791034567850', 'not_found', '[]', now(), now()) $$,
  '23514', null, 'a copy that is already expired is no copy');
select throws_ok(
  $$ insert into public.google_books_cache (cache_key, status, volumes, expires_at) values ('q:' || repeat('x', 400), 'not_found', '[]', now() + interval '1 hour') $$,
  '23514', null, 'a key over 400 characters is refused');

-- -------------------------------------------------------------- the budget

select is(public.google_books_budget_take(2), true, 'the first request of the day is within a limit of 2');
select is(public.google_books_budget_take(2), true, 'the second too');
select is(public.google_books_budget_take(2), false, 'the third is refused');
select is(
  (select used from public.google_books_budget where day = (now() at time zone 'America/Los_Angeles')::date),
  2, 'a refused request is not counted: the day stands at 2');
select is(public.google_books_budget_take(3), true, 'a higher limit (the owner raised the quota) lets the day go on');
select throws_ok($$ select public.google_books_budget_take(0) $$, '22023', 'budget_invalid', 'a limit under 1 is refused');
select throws_ok($$ select public.google_books_budget_take(null) $$, '22023', 'budget_invalid', 'a missing limit is refused');

-- ---------------------------------------------------------------- the purge

insert into public.google_books_cache (cache_key, status, volumes, fetched_at, expires_at)
values ('isbn:9791034567867', 'found', '[{"id":"old"}]', now() - interval '3 hours', now() - interval '2 hours'),
       ('isbn:9791034567874', 'found', '[{"id":"recent"}]', now() - interval '90 minutes', now() - interval '30 minutes');
insert into public.google_books_budget (day, used) values (current_date - 40, 500), (current_date - 5, 120);

reset role;
select is(private.purge_google_books() >= 1, true, 'the purge answers how many rows it deleted');
select is((select count(*)::int from public.google_books_cache where cache_key = 'isbn:9791034567867'), 0, 'a copy expired for over an hour is gone');
select is((select count(*)::int from public.google_books_cache where cache_key = 'isbn:9791034567874'), 1, 'one that expired a moment ago stays (a lookup may still be in flight)');
select is((select count(*)::int from public.google_books_cache where cache_key = 'isbn:9791034567898'), 1, 'a live copy stays');
select is((select count(*)::int from public.google_books_budget where day = current_date - 40), 0, 'a counter over a month old is gone');
select is((select count(*)::int from public.google_books_budget where day = current_date - 5), 1, 'a recent one stays');

-- ------------------------------------------------- nobody else, in any way

select tests.act_as(:'ida_id');
select throws_ok($$ select * from public.google_books_cache $$, '42501', null, 'a member cannot read the cache (a key is what a member typed)');
select throws_ok($$ insert into public.google_books_cache (cache_key, status, expires_at) values ('isbn:9791034567881', 'not_found', now() + interval '1 hour') $$, '42501', null, 'nor write it');
select throws_ok($$ select * from public.google_books_budget $$, '42501', null, 'nor read the budget');
select throws_ok($$ select public.google_books_budget_take(900) $$, '42501', null, 'nor spend it');
select throws_ok($$ select private.purge_google_books() $$, '42501', null, 'nor purge');
reset role;
set local role anon;
select throws_ok($$ select * from public.google_books_cache $$, '42501', null, 'signed out sees nothing either');
reset role;

-- -------------------------------------------------------------------- genres

insert into public.books (title, authors, isbn13, source) values ('Das Leuchten der Nordsee', '{Ida Beispiel}', '9791034567898', 'import');
select lives_ok(
  $$ insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
     select id, 'thriller', 1, 'google', 0.6, 1 from public.books where isbn13 = '9791034567898' and owner_id is null $$,
  'a genre may come from Google');
select throws_ok(
  $$ insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
     select id, 'crime', 2, 'bing', 0.6, 1 from public.books where isbn13 = '9791034567898' and owner_id is null $$,
  '23514', null, 'and from no other new source');

-- ------------------------------------------------------------------- covers

select is(private.cover_allowed('https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api'), true, 'Google''s cover image may be linked');
select is(private.cover_allowed('https://books.google.com/books?id=ZZhit0001AAA'), false, 'its other pages are no cover');
select is(private.cover_allowed('https://books.google.com.evil.example/books/content?id=a'), false, 'a lookalike host is none');
select is(private.cover_allowed('http://books.google.com/books/content?id=a'), false, 'over https only');
select is(private.cover_allowed('https://covers.openlibrary.org/b/id/1-L.jpg'), true, 'the other hosts are as they were');

select is(private.cover_storable('https://covers.openlibrary.org/b/id/1-L.jpg'), true, 'Open Library''s cover may be stored');
select is(private.cover_storable('https://books.google.com/books/content?id=ZZhit0001AAA&printsec=frontcover&img=1&zoom=1&source=gbs_api'), false, 'Google''s never (linked, not copied)');

-- A Book with a Google cover in a Library: shown inside the app only, never queued for the cover store, never "unqueued" in the owner's status.
insert into public.books (title, authors, isbn13, source, cover_url) values
  ('Google Cover Book', '{Ida Beispiel}', '9791034567904', 'import', 'https://books.google.com/books/content?id=ZZde000001&printsec=frontcover&img=1&zoom=1&source=gbs_api'),
  ('Open Library Cover Book', '{Ida Beispiel}', '9791034567911', 'import', 'https://covers.openlibrary.org/b/id/424242-L.jpg');
insert into public.library_entries (member_id, book_id)
select :'ida_id'::uuid, id from public.books where isbn13 in ('9791034567904', '9791034567911') and owner_id is null;

select is(private.cover_shown((select b from public.books b where b.isbn13 = '9791034567904' and b.owner_id is null)), false, 'a Google cover is not shown outside the app');
select is(private.cover_shown((select b from public.books b where b.isbn13 = '9791034567911' and b.owner_id is null)), true, 'an Open Library cover is');

select is(private.cover_store_reconcile() >= 1, true, 'the reconcile queues a Book with a storable cover');
select is(
  (select count(*)::int from private.cover_store_queue q join public.books b on b.id = q.book_id where b.isbn13 = '9791034567904' and b.owner_id is null),
  0, 'and never one whose cover is Google''s');
select is(
  (select count(*)::int from private.cover_store_queue q join public.books b on b.id = q.book_id where b.isbn13 = '9791034567911' and b.owner_id is null),
  1, 'the Open Library one is queued');

select * from finish();
rollback;
