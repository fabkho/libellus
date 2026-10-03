-- Changing an entry's edition at the database boundary (issue #41):
--   supabase test db
--
-- change_edition(entry, snapshot) points one of the member's entries at
-- another edition: the Book is found or added the way add_to_library does it,
-- the entry stays the same row with its reads, Ratings, reviews and places on
-- Collections, its progress page is clamped to the new page count, and a Manual
-- book left behind is deleted. Refused: an edition she holds as another entry,
-- another member's entry, a snapshot that cannot be a Catalogue Book.
-- Members act through their JWT claims; assertions ask about the rows this test
-- made, never about how many rows a table holds.

begin;
select plan(42);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-EDITION', 'change edition test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-EDITION"}'::jsonb, now(), now(), now());
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

-- An entry's Book, past RLS (a deleted Manual book is no longer visible to anyone).
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$
  select book_id from public.library_entries where id = p_entry
$$;
create or replace function tests.book_exists(p_book uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.books where id = p_book)
$$;

select tests.member('ida@edition.test') as ida_id \gset
select tests.member('max@edition.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Source ids and ISBNs no real book has (979-0 is music's range).
\set dune_en '{"title":"Dune","authors":["Frank Herbert"],"source":"apple","apple_id":"990000004101","isbn13":"9790000041011","page_count":600}'
\set dune_de '{"title":"Der Wüstenplanet","authors":["Frank Herbert"],"source":"openlibrary","openlibrary_edition_key":"OL990004102M","openlibrary_work_key":"OL990004100W","isbn13":"9790000041028","page_count":300,"language":"ger","cover_url":"https://covers.openlibrary.org/b/id/990004102-L.jpg"}'
\set emma_book '{"title":"Emma","authors":["Jane Austen"],"source":"apple","apple_id":"990000004103"}'
\set long_walk '{"title":"Todesmarsch","authors":["Stephen King"],"source":"apple","apple_id":"990000004104","isbn13":"9790000041042"}'

-- Ida: Dune read once (finished, rated, reviewed), now being read again at
-- page 450 of 600, on her Sci-fi Collection. Emma on Want to read. A Manual
-- book she finished. Max: the same English Dune.
select tests.act_as(:'ida_id');
select (public.add_to_library(:'dune_en', 'finished', current_date - 90, current_date - 80, 18, 'Spice.')).id as dune \gset
select public.read_again(:'dune', current_date - 3);
select public.update_progress(:'dune', 450, null);
select (public.add_to_library(:'emma_book')).id as emma \gset
select (public.add_manual_book('Todesmarsch', array['Richard Bachman'], null, 363, 'finished',
  current_date - 30, current_date - 20, 14, null)).id as walk \gset
select id as scifi from public.create_collection('Sci-fi') \gset
select public.add_to_collection(:'scifi', format('{"id":"%s"}', tests.book_of(:'dune'))::jsonb);

select tests.book_of(:'dune') as dune_en_id \gset
select tests.book_of(:'walk') as walk_manual_id \gset
select array_agg(id order by id)::text as dune_sessions from public.reading_sessions where entry_id = :'dune' \gset

select tests.act_as(:'max_id');
select (public.add_to_library(:'dune_en', 'reading', current_date - 5)).id as max_dune \gset
select public.update_progress(:'max_dune', 500, null);

select tests.act_as(:'ida_id');

-- ------------------------------------------------- a new edition, from a source

select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_de'),
  'a member changes her entry to another edition a source found');
select isnt(tests.book_of(:'dune'), :'dune_en_id'::uuid, 'the entry points at another Book');
select results_eq(
  format($$ select b.title, b.isbn13, b.source::text, b.owner_id is null, b.page_count, b.cover_url
             from public.library_entries e join public.books b on b.id = e.book_id where e.id = %L $$, :'dune'),
  $$ values ('Der Wüstenplanet', '9790000041028', 'openlibrary', true, 300,
             'https://covers.openlibrary.org/b/id/990004102-L.jpg') $$,
  'the new edition entered the Catalogue with its snapshot, as add_to_library would');
select is(
  (select edition_changed_at is not null from public.library_entries where id = :'dune'), true,
  'the entry records that the member chose its edition');

select is(
  (select array_agg(id order by id)::text from public.reading_sessions where entry_id = :'dune'), :'dune_sessions',
  'every read stays with the entry');
select results_eq(
  format($$ select rating, review from public.reading_sessions where entry_id = %L and outcome = 'finished' $$, :'dune'),
  $$ values (18::smallint, 'Spice.') $$,
  'the finished read keeps its Rating and review');
select is(
  (select status::text from public.library_entries where id = :'dune'), 'reading',
  'the Status stays what the reads say');
select ok(
  exists (select 1 from public.collection_entries where collection_id = :'scifi' and entry_id = :'dune'),
  'the entry stays on its Collection');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L and outcome is null $$, :'dune'),
  $$ values (300) $$,
  'page 450 of 600 is clamped to the new edition''s last page, 300');
select ok(tests.book_exists(:'dune_en_id'), 'the old Catalogue Book stays in the Catalogue');

-- ------------------------------------------------- back to a Catalogue Book

select is(
  (select id from public.change_edition(:'dune', :'dune_en')), :'dune'::uuid,
  'changing back to a Book already in the Catalogue returns the same entry');
select is(tests.book_of(:'dune'), :'dune_en_id'::uuid, 'it finds the Catalogue row by its keys, no copy');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L and outcome is null $$, :'dune'),
  $$ values (300) $$,
  'a larger page count leaves the page as it is');
select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_en'),
  'picking the edition it already has changes nothing');
select is(tests.book_of(:'dune'), :'dune_en_id'::uuid, 'and the entry keeps its Book');

-- A percentage means the same on any edition.
select public.update_progress(:'dune', null, 80);
select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_de'),
  'with progress in percent');
select results_eq(
  format($$ select progress_page, progress_percent from public.reading_sessions where entry_id = %L and outcome is null $$, :'dune'),
  $$ values (null::integer, 80::smallint) $$,
  'a percentage is never clamped');

-- ------------------------------------------------------- other members

select tests.act_as(:'max_id');
select results_eq(
  format($$ select e.book_id, s.progress_page from public.library_entries e
             join public.reading_sessions s on s.entry_id = e.id where e.id = %L $$, :'max_dune'),
  format($$ values (%L::uuid, 500) $$, :'dune_en_id'),
  'Max''s entry for the old edition keeps its Book and his page');
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_en'),
  'P0002', 'entry_not_found', 'Max cannot change Ida''s entry: it is not found');
select tests.act_as(:'ida_id');
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'max_dune', :'dune_de'),
  'P0002', 'entry_not_found', 'nor Ida Max''s');
select is(
  (select tests.book_of(:'max_dune')), :'dune_en_id'::uuid,
  'and Max''s entry is untouched');
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, gen_random_uuid(), :'dune_de'),
  'P0002', 'entry_not_found', 'an entry that does not exist is not found');

-- ------------------------------------------------------------ refusals

select tests.book_of(:'emma') as emma_id \gset
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'emma_book'),
  '23505', 'edition_in_library', 'an edition she holds as another entry is refused');
select results_eq(
  format($$ select e.book_id from public.library_entries e where e.id in (%L, %L) order by e.id = %L desc $$, :'dune', :'emma', :'dune'),
  format($$ values (%L::uuid), (%L::uuid) $$, tests.book_of(:'dune'), :'emma_id'),
  'and both entries keep their Books');
select isnt(tests.book_of(:'dune'), :'emma_id'::uuid, 'Dune is not on Emma''s Book');

select throws_ok(
  format($$ select public.change_edition(%L, '{"title":"Dune","source":"manual"}') $$, :'dune'),
  '22023', 'book_invalid', 'a Manual book snapshot is refused: only Catalogue editions');
select throws_ok(
  format($$ select public.change_edition(%L, '{"title":"Dune","source":"apple"}') $$, :'dune'),
  '22023', 'book_invalid', 'a snapshot with no ISBN and no source id is refused');
select throws_ok(
  format($$ select public.change_edition(%L, '{"title":"Dune","source":"import","isbn13":"9790000041998"}') $$, :'dune'),
  '22023', 'book_invalid', 'an import snapshot that matches no Catalogue Book is refused');
select throws_ok(
  format($$ select public.change_edition(%L, null) $$, :'dune'),
  '22023', 'book_invalid', 'no snapshot at all is refused');

-- A refused change adds nothing to the Catalogue.
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune',
    '{"title":"Emma","authors":["Jane Austen"],"source":"apple","apple_id":"990000004103","isbn13":"9790000041998"}'),
  '23505', 'edition_in_library', 'an edition she holds is found by its source id too');
select ok(
  not exists (select 1 from public.books where isbn13 = '9790000041998'),
  'and the refusal left no Book behind');

-- ------------------------------------------------------------ Manual books

select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'walk', :'long_walk'),
  'a Manual book''s entry switches to a Catalogue edition');
select results_eq(
  format($$ select b.title, b.source::text, b.owner_id is null from public.library_entries e
             join public.books b on b.id = e.book_id where e.id = %L $$, :'walk'),
  $$ values ('Todesmarsch', 'apple', true) $$,
  'the entry now has the Catalogue Book');
select results_eq(
  format($$ select outcome::text, rating from public.reading_sessions where entry_id = %L $$, :'walk'),
  $$ values ('finished', 14::smallint) $$,
  'with its read and Rating');
select is(tests.book_exists(:'walk_manual_id'), false,
  'the Manual book nothing uses any more is deleted');
select ok(
  not exists (select 1 from public.search_books('Todesmarsch', 20) where owner_id is not null),
  'so her search no longer finds a stale private copy');

-- ------------------------------------------------------------ add_to_library

-- add_to_library now finds its Book through the same function: unchanged.
select is(
  (select status::text from public.add_to_library(:'dune_en')), 'want_to_read',
  'add_to_library still adds a Catalogue Book (here the edition Dune left)');
select throws_ok(
  format($$ select public.add_to_library(%L) $$, :'dune_en'),
  '23505', 'already_in_library', 'and still refuses it the second time');
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_en'),
  '23505', 'edition_in_library', 'now that she holds it again, changing Dune back is refused');

-- ------------------------------------------------------------ no member

select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_en'),
  '42501', 'not_signed_in', 'no member, no change');
reset role;
set local role anon;
select throws_ok(
  format($$ select public.change_edition(%L, %L) $$, :'dune', :'dune_en'),
  '42501', null, 'the anonymous role may not call it at all');
reset role;
select is(
  has_function_privilege('authenticated', 'public.catalogue_book_for(jsonb)', 'execute'), false,
  'members cannot call the Book step on its own');

select * from finish();
rollback;
