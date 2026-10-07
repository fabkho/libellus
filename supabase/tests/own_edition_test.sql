-- Formats and the member's own edition at the database boundary:
--   supabase test db
--
-- A Book keeps the format its source said (Apple's are ebooks); the member's
-- own word on her entry's format is her entry's, never the shared Book's, and
-- one equal to the Book's is none. change_edition takes the format she picked
-- for the new edition. use_own_edition makes her own edition (a Manual book:
-- hers, private) from what she typed and moves her entry to it, keeping its
-- reads, Collections and progress (cut back to the new page count). Members act
-- through their JWT claims; assertions ask about the rows this test made.

begin;
select plan(40);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-OWN-EDITION', 'own edition test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-OWN-EDITION"}'::jsonb, now(), now(), now());
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

-- An entry's Book, past RLS.
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$
  select book_id from public.library_entries where id = p_entry
$$;
create or replace function tests.book_exists(p_book uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.books where id = p_book)
$$;

select tests.member('ida@own-edition.test') as ida_id \gset
select tests.member('max@own-edition.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Source ids and ISBNs no real book has (979-0 is music's range).
\set legend_apple '{"title":"I Am Legend","authors":["Richard Matheson"],"source":"apple","apple_id":"990000004201","isbn13":"9790000042018","page_count":320}'
\set legend_ol '{"title":"I Am Legend","authors":["Richard Matheson"],"source":"openlibrary","openlibrary_edition_key":"OL990004202M","isbn13":"9790000042025","page_count":176,"format":"paperback"}'
\set legend_ol_bare '{"title":"I Am Legend","authors":["Richard Matheson"],"source":"openlibrary","openlibrary_edition_key":"OL990004203M","isbn13":"9790000042032"}'

-- Ida reads I Am Legend (Apple's ebook) at page 250, on her Horror Collection; she finished it once.
select tests.act_as(:'ida_id');
select (public.add_to_library(:'legend_apple', 'finished', current_date - 90, current_date - 80, 16, 'Neville.')).id as legend \gset
select public.read_again(:'legend', current_date - 3);
select public.update_progress(:'legend', 250, null);
select id as horror from public.create_collection('Horror') \gset
select public.add_to_collection(:'horror', format('{"id":"%s"}', tests.book_of(:'legend'))::jsonb);
select tests.book_of(:'legend') as apple_id \gset
select array_agg(id order by id)::text as legend_sessions from public.reading_sessions where entry_id = :'legend' \gset

-- ------------------------------------------------------------- formats

select is((select format::text from public.books where id = :'apple_id'), 'ebook', 'an Apple edition is an ebook');
select is((select format_override from public.library_entries where id = :'legend'), null, 'and her entry has no word of its own');

select lives_ok(
  format($$ select public.set_entry_format(%L, 'paperback') $$, :'legend'),
  'she says her edition is a paperback');
select is((select format_override::text from public.library_entries where id = :'legend'), 'paperback', 'her entry says so');
select is((select format::text from public.books where id = :'apple_id'), 'ebook', 'the shared Book still says what its source said');
select lives_ok(
  format($$ select public.set_entry_format(%L, 'ebook') $$, :'legend'),
  'she says it is the ebook after all');
select is((select format_override from public.library_entries where id = :'legend'), null, 'a word equal to the Book''s format is none');
select lives_ok(
  format($$ select public.set_entry_format(%L, 'audiobook') $$, :'legend'),
  'an audiobook');
select lives_ok(
  format($$ select public.set_entry_format(%L, null) $$, :'legend'),
  'and back to the Book''s own');
select is((select format_override from public.library_entries where id = :'legend'), null, 'none is the Book''s format');

-- ------------------------------------------------- change_edition with a format

select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'legend', :'legend_ol'),
  'she changes to an edition a source says is a paperback');
select results_eq(
  format($$ select b.format::text, e.format_override::text from public.library_entries e join public.books b on b.id = e.book_id where e.id = %L $$, :'legend'),
  $$ values ('paperback', null::text) $$,
  'the new Book keeps the source''s format, her entry adds nothing');
select lives_ok(
  format($$ select public.change_edition(%L, %L, 'hardcover') $$, :'legend', :'legend_ol_bare'),
  'she changes to an edition without a format, saying it is a hardcover');
select results_eq(
  format($$ select b.format::text, e.format_override::text from public.library_entries e join public.books b on b.id = e.book_id where e.id = %L $$, :'legend'),
  $$ values (null::text, 'hardcover') $$,
  'the shared Book stays without one, her entry says hardcover');
select lives_ok(
  format($$ select public.change_edition(%L, %L) $$, :'legend', :'legend_ol'),
  'back to the paperback');
select is((select format_override from public.library_entries where id = :'legend'), null, 'her word was about the other edition: gone');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L and outcome is null $$, :'legend'),
  $$ values (176) $$,
  'page 250 is cut back to the paperback''s 176');

-- ------------------------------------------------------------ her own edition

select throws_ok(
  format($$ select public.use_own_edition(%L, '{"published_year":2022}') $$, :'legend'),
  '22023', 'book_invalid', 'her own edition needs a format');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"paperback","isbn13":"9781399607736"}') $$, :'legend'),
  '22023', 'isbn_invalid', 'an ISBN whose check digit does not add up is refused');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"paperback","cover_url":"http://example.com/c.jpg"}') $$, :'legend'),
  '22023', 'book_invalid', 'a cover that is not https is refused');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"paperback","page_count":0}') $$, :'legend'),
  '22023', 'book_invalid', 'a page count that is not positive is refused');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"paperback","language":"English"}') $$, :'legend'),
  '22023', 'book_invalid', 'a language that is not a code is refused');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"paperback","published_year":3000}') $$, :'legend'),
  '23514', null, 'a year the table does not take is refused');
select is(tests.book_of(:'legend'), (select id from public.books where openlibrary_edition_key = 'OL990004202M'),
  'a refused own edition leaves the entry where it was');

select lives_ok(
  format($$ select public.use_own_edition(%L, %L) $$, :'legend',
    '{"format":"paperback","isbn13":"978-1-399-60773-5","isbn10":"1399607731","published_year":2022,"publisher":" Gollancz ","page_count":160,"language":"EN","cover_url":"https://example.com/legend.jpg","cover_thumbhash":"abc","cover_dominant":"#AABBCC","cover_secondary":"#112233"}'),
  'she makes her own edition from what she typed');
select tests.book_of(:'legend') as own_id \gset
select results_eq(
  format($$ select title, authors, isbn13, isbn10, published_year::int, publisher, page_count, language, format::text,
                   cover_url, cover_dominant, source::text, owner_id from public.books where id = %L $$, :'own_id'),
  format($$ values ('I Am Legend', array['Richard Matheson'], '9781399607735', '1399607731', 2022, 'Gollancz', 160, 'en',
                    'paperback', 'https://example.com/legend.jpg', '#aabbcc', 'manual', %L::uuid) $$, :'ida_id'),
  'a Manual book of hers, the title and author her Book''s, the rest as she typed it, tidied');
select is((select format_override from public.library_entries where id = :'legend'), null, 'its format is the Book''s own');
select is(
  (select array_agg(id order by id)::text from public.reading_sessions where entry_id = :'legend'), :'legend_sessions',
  'every read stays with the entry');
select results_eq(
  format($$ select rating, review from public.reading_sessions where entry_id = %L and outcome = 'finished' $$, :'legend'),
  $$ values (16::smallint, 'Neville.') $$,
  'the finished read keeps its Rating and review');
select ok(
  exists (select 1 from public.collection_entries where collection_id = :'horror' and entry_id = :'legend'),
  'the entry stays on its Collection');
select results_eq(
  format($$ select progress_page from public.reading_sessions where entry_id = %L and outcome is null $$, :'legend'),
  $$ values (160) $$,
  'page 176 is cut back to her edition''s 160');

select tests.act_as(:'max_id');
select is((select count(*)::int from public.books where id = :'own_id'), 0, 'Max never sees her own edition');
select ok(
  not exists (select 1 from public.search_books('I Am Legend') where id = :'own_id'),
  'nor does his search find it');
select throws_ok(
  format($$ select public.use_own_edition(%L, '{"format":"ebook"}') $$, :'legend'),
  'P0002', 'entry_not_found', 'Max cannot make an edition for Ida''s entry');
select throws_ok(
  format($$ select public.set_entry_format(%L, 'ebook') $$, :'legend'),
  'P0002', 'entry_not_found', 'nor say what format it is');
select tests.act_as(:'ida_id');

select lives_ok(
  format($$ select public.set_entry_format(%L, 'hardcover') $$, :'legend'),
  'she may still correct her own edition''s format');
select is((select format_override::text from public.library_entries where id = :'legend'), 'hardcover', 'as her entry''s word');

-- Leaving her own edition deletes it, as any Manual book left behind.
select lives_ok(
  format($$ select public.use_own_edition(%L, '{"format":"ebook","title":"  ","authors":[]}') $$, :'legend'),
  'a second own edition, blank title and authors');
select results_eq(
  format($$ select b.title, b.authors, b.format::text, e.format_override from public.library_entries e join public.books b on b.id = e.book_id where e.id = %L $$, :'legend'),
  $$ values ('I Am Legend', array['Richard Matheson'], 'ebook', null::public.book_format) $$,
  'takes the title and author of the edition it replaces, and her word on the old one is gone');
select ok(not tests.book_exists(:'own_id'), 'her first own edition, used by nothing, is deleted');

select * from finish();
rollback;
