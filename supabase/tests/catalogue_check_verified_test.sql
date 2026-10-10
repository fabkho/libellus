-- A verified Book is the source's, all of it (social v2a contract §5; review MEDIUM 3):
--   supabase test db
--
-- catalogue_check_save writes the authors, cover, description, publisher, language and format the
-- source gave, and nothing where it gave none: nothing of what the first member sent stays that the
-- source did not say. Pages and year are the source's, else the member's own only when plausible.
-- The stored title must be the source's by work_title_key (the second lock of the identity check): a
-- Book the source names otherwise is marked failed and nothing is written.

begin;
select plan(22);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-VERIFIED-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-VERIFIED-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- A snapshot the way a client sends one: a blurb of her own, and a cover on a host that is not a source's.
create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9800000000 + floor(random() * 99999999))::bigint::text,
                            'description', 'Blurb of ' || p_title,
                            'cover_url', 'https://example.org/' || md5(p_title) || '.jpg',
                            'cover_thumbhash', 'abc', 'cover_dominant', '#112233', 'cover_secondary', '#445566')
$$;

create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

insert into ids values ('ada', tests.member('ada@verified.pgtap.test', 'Ada'));

select tests.act_as((select id from ids where name = 'ada'));
-- What she sent: everything of her own, on every column the check writes.
insert into ids values
  ('bare',   (public.add_to_library(tests.snap('Bare Book') || '{"publisher":"Her Press","language":"de","format":"hardcover","page_count":300,"published_year":1999}', 'want_to_read', null)).id),
  ('facts',  (public.add_to_library(tests.snap('Facts Book') || '{"publisher":"Her Press","language":"de","format":"hardcover","page_count":300,"published_year":1999}', 'want_to_read', null)).id),
  ('odd',    (public.add_to_library(tests.snap('Odd Book') || '{"page_count":99999,"published_year":2099}', 'want_to_read', null)).id),
  ('same',   (public.add_to_library(tests.snap('Same Cover Book') || '{"cover_url":"https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg"}', 'want_to_read', null)).id),
  ('other',  (public.add_to_library(tests.snap('Other Book'), 'want_to_read', null)).id);

reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('bare', 'facts', 'odd', 'same', 'other');

-- ------------------------------------------------ a source that says only the title

select is(public.catalogue_check_save((select id from ids where name = 'b_bare'), '{"title":"Bare Book"}'), true,
  'a save with a title and nothing else is a save');
select is((select (authors, description, cover_url, cover_thumbhash, cover_dominant, cover_secondary)::text from public.books where id = (select id from ids where name = 'b_bare')),
  '({},,,,,)',
  'no authors, no description, no cover (and no hash or colours of it) stay of the first member''s');
select is((select (publisher, language, format)::text from public.books where id = (select id from ids where name = 'b_bare')),
  '(,,)', 'nor her publisher, language or format');
select is((select (page_count, published_year)::text from public.books where id = (select id from ids where name = 'b_bare')),
  '(300,1999)', 'but her page count and year stay while they are plausible');
select ok((select checked_at is not null and not check_failed from public.books where id = (select id from ids where name = 'b_bare')),
  'and the Book is checked');

-- ------------------------------------------------------- a source that says it all

select is(public.catalogue_check_save((select id from ids where name = 'b_facts'), jsonb_build_object(
  'title', 'Facts Book: A Novel', 'authors', jsonb_build_array('Real Author'), 'description', 'Real blurb',
  'cover_url', 'https://covers.openlibrary.org/b/id/12-L.jpg', 'publisher', 'Penguin', 'language', 'eng',
  'format', 'paperback', 'page_count', 272, 'published_year', 2020)), true,
  'a save with the source''s facts');
select is((select (title, authors, description, cover_url, cover_thumbhash, cover_dominant)::text from public.books where id = (select id from ids where name = 'b_facts')),
  '("Facts Book: A Novel","{""Real Author""}","Real blurb",https://covers.openlibrary.org/b/id/12-L.jpg,,)',
  'writes the source''s title, authors, description and cover, dropping the old picture''s hash and colours');
select is((select (publisher, language, format, page_count, published_year)::text from public.books where id = (select id from ids where name = 'b_facts')),
  '(Penguin,eng,paperback,272,2020)', 'and its publisher, language, format, pages and year over hers');

-- ------------------------------------------- pages and year of her own that cannot be

select public.catalogue_check_save((select id from ids where name = 'b_odd'), '{"title":"Odd Book"}');
select is((select (page_count, published_year)::text from public.books where id = (select id from ids where name = 'b_odd')),
  '(,)', 'a page count or year of hers out of range (99999 pages, 2099) is not kept');

-- ------------------------------------------- the source's own values are checked too

select public.catalogue_check_save((select id from ids where name = 'b_other'), jsonb_build_object(
  'title', 'Other Book', 'publisher', repeat('p', 201), 'language', 'English', 'format', 'scroll',
  'page_count', 1000000, 'published_year', 12));
select is((select (publisher, language, format, page_count, published_year)::text from public.books where id = (select id from ids where name = 'b_other')),
  '(,,,,)', 'a publisher too long, a language that is not a code, a format it is not, 1 000 000 pages and the year 12 are not stored');

-- ----------------------------------------------------- the same picture keeps its hash

select public.catalogue_check_save((select id from ids where name = 'b_same'), jsonb_build_object(
  'title', 'Same Cover Book', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg'));
select is((select (cover_url, cover_thumbhash, cover_dominant, cover_secondary)::text from public.books where id = (select id from ids where name = 'b_same')),
  '(https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg,abc,#112233,#445566)',
  'a cover that is the one she sent keeps its thumbhash and colours');

-- ------------------------------------------------------------- the title lock

reset role;
select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('planted', (public.add_to_library(tests.snap('Planted Title'), 'want_to_read', null)).id),
  ('bracket', (public.add_to_library(tests.snap('The Name (Series, #2)') || '{"source":"openlibrary","apple_id":null,"openlibrary_edition_key":"OL99999991M"}', 'want_to_read', null)).id),
  ('accent',  (public.add_to_library(tests.snap('Émile') || '{"source":"openlibrary","apple_id":null,"openlibrary_edition_key":"OL99999992M"}', 'want_to_read', null)).id);
reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('planted', 'bracket', 'accent');

select is(public.catalogue_check_save((select id from ids where name = 'b_planted'), jsonb_build_object(
  'title', 'A Bestseller', 'authors', jsonb_build_array('Famous'), 'description', 'The bestseller''s blurb')), false,
  'a source title that is not the stored title (by work_title_key) writes nothing: the answer is false');
select is((select (title, authors, description, check_failed, checked_at is not null)::text from public.books where id = (select id from ids where name = 'b_planted')),
  '("Planted Title","{""An Author""}","Blurb of Planted Title",t,t)',
  'the Book is failed and checked, with the data the member sent, none of the bestseller''s');
select is((select count(*)::int from private.catalogue_check_state where book_id = (select id from ids where name = 'b_planted')), 0,
  'and is out of the queue');
select is(public.catalogue_check_save((select id from ids where name = 'b_planted'), '{"title":"Planted Title"}'), false,
  'a failed Book is not written again');

select is(public.catalogue_check_save((select id from ids where name = 'b_bracket'), '{"title":"The Name"}'), true,
  'brackets in the stored title do not count against the source''s');
select is(public.catalogue_check_save((select id from ids where name = 'b_accent'), '{"title":"Emile: A Life"}'), true,
  'nor accents, nor a subtitle after a colon');

select throws_ok($q$select public.catalogue_check_save(gen_random_uuid(), '{"authors":["No Title"]}')$q$, '22023', 'result_invalid',
  'a result without a title is refused');
select throws_ok($q$select public.catalogue_check_save(gen_random_uuid(), '{"title":5}')$q$, '22023', 'result_invalid',
  'and a title that is not text');
select is(public.catalogue_check_save(gen_random_uuid(), '{"title":"Nobody"}'), false, 'a save for no Book writes nothing');

-- ------------------------------------------------ nothing here for a member to call
select tests.act_as((select id from ids where name = 'ada'));
select throws_ok($q$select public.catalogue_check_save(gen_random_uuid(), '{"title":"x"}')$q$, '42501', null,
  'a member cannot save');
reset role;
select is((select count(*)::int from public.books where owner_id is null and checked_at is null), 0,
  'no Book of this test is left unchecked, none was made checked by a member');

select * from finish();
rollback;
