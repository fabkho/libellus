-- Catalogue input (20261022010000_catalogue_input.sql; security assessment F1, F17):
--   supabase test db
--
-- F1  a cover off the allow-list never reaches a Catalogue Book: the table refuses it, and
--     add_to_library / import_books add the Book without it (and without its thumbhash and
--     colours); a Manual book's private cover stays; the allow-list is one function that
--     `cover_shown` calls too.
-- F17 an Open Library key that is not one of Open Library's own is refused.

begin;
select plan(33);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-CAT-INPUT', 'catalogue input test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-CAT-INPUT"}'::jsonb, now(), now(), now());
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

select tests.member('ida@catinput.test') as ida_id \gset
select tests.member('max@catinput.test') as max_id \gset

-- ------------------------------------------------------- F1: the one allow-list

select is(private.cover_allowed('https://covers.openlibrary.org/b/id/8231856-L.jpg'), true, 'Open Library covers are allowed');
select is(private.cover_allowed('https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg'), true, 'Apple artwork is allowed');
select is(private.cover_allowed('https://books.fabkho.dev/v2/covers/1.jpg'), true, 'the Regal library is allowed');
select is(private.cover_allowed('https://evil.example/pixel.gif'), false, 'another host is not');
select is(private.cover_allowed('http://covers.openlibrary.org/b/id/1-L.jpg'), false, 'http is not');
select is(private.cover_allowed('javascript:alert(1)'), false, 'javascript: is not');
select is(private.cover_allowed('https://covers.openlibrary.org@evil.example/x.gif'), false, 'host@evil is not');
select is(private.cover_allowed('https://covers.openlibrary.org.evil.example/x.gif'), false, 'host.evil is not');
select is(private.cover_allowed('https://evil.example/#@covers.openlibrary.org/'), false, 'host in a fragment is not');
select is(private.cover_allowed(null), false, 'no URL is not allowed (callers test for null)');

-- ---- cover_shown (the social surfaces) answers by the same list; set up below, asked after the inserts

-- ------------------------------------------------------- F1: the table

select throws_ok(
  $$ insert into public.books (title, source, apple_id, cover_url) values ('Pixel', 'apple', '990000100001', 'https://evil.example/p.gif') $$,
  '23514', null, 'a Catalogue Book with a cover off the list is refused by the table');
select lives_ok(
  $$ insert into public.books (title, source, apple_id, cover_url) values ('Fine', 'apple', '990000100002', 'https://is2-ssl.mzstatic.com/image/x.jpg') $$,
  'a Catalogue Book with an allowed cover is stored');
select throws_ok(
  $$ update public.books set cover_url = 'https://evil.example/p.gif' where apple_id = '990000100002' $$,
  '23514', null, 'nor can the cover be swapped afterwards');
select lives_ok(
  format($$ insert into public.books (title, authors, source, owner_id, cover_url) values ('Mine', '{Ida}', 'manual', %L, 'https://example.com/mine.jpg') $$, :'ida_id'),
  'a Manual book keeps a cover of any host: it is private to its owner');
select is(
  (select private.cover_shown(b) from public.books b where b.apple_id = '990000100002'), true,
  'cover_shown shows the allowed cover to others');
select is(
  (select private.cover_shown(b) from public.books b where b.title = 'Mine' and b.owner_id is not null), false,
  'and still not a Manual book''s private one');

-- ------------------------------------------------------- F1: the functions

select tests.act_as(:'ida_id');

select lives_ok(
  $$ select public.add_to_library('{"source":"apple","apple_id":"990000100010","title":"Cover Probe One","authors":["A"],
        "cover_url":"https://evil.example/p.gif","cover_thumbhash":"abc","cover_dominant":"#aabbcc","cover_secondary":"#112233"}'::jsonb, 'want_to_read') $$,
  'add_to_library does not fail on a cover off the list');
select results_eq(
  $$ select cover_url, cover_thumbhash, cover_dominant, cover_secondary from public.books where apple_id = '990000100010' $$,
  $$ values (null::text, null::text, null::text, null::text) $$,
  'the Book is added without the cover, its thumbhash and its colours');
select lives_ok(
  $$ select public.add_to_library('{"source":"apple","apple_id":"990000100011","title":"Cover Probe Two","authors":["A"],
        "cover_url":"https://is3-ssl.mzstatic.com/image/y.jpg","cover_thumbhash":"abc","cover_dominant":"#AABBCC","cover_secondary":"#112233"}'::jsonb, 'want_to_read') $$,
  'add_to_library with an allowed cover');
select results_eq(
  $$ select cover_url, cover_thumbhash, cover_dominant, cover_secondary from public.books where apple_id = '990000100011' $$,
  $$ values ('https://is3-ssl.mzstatic.com/image/y.jpg', 'abc', '#aabbcc', '#112233') $$,
  'an allowed cover is kept with its thumbhash and colours');
select lives_ok(
  $$ select public.add_to_library('{"source":"apple","apple_id":"990000100012","title":"Cover Probe Three","authors":["A"],
        "cover_url":"javascript:alert(1)"}'::jsonb, 'want_to_read') $$,
  'add_to_library does not fail on a javascript: cover');
select is((select cover_url from public.books where apple_id = '990000100012'), null, 'it is stored without it');

select results_eq(
  $$ select outcome from jsonb_to_recordset(public.import_books('[{"key":"goodreads:catinput2","status":"want_to_read",
        "book":{"title":"Import New","authors":["A"],"isbn13":"9780140449144","source":"openlibrary","openlibrary_edition_key":"OL990100001M",
                "cover_url":"https://evil.example/i.gif","cover_thumbhash":"abc","cover_dominant":"#aabbcc","cover_secondary":"#112233"}}]'::jsonb)) as r(outcome text) $$,
  $$ values ('added') $$,
  'import_books adds a Book whose cover is off the list');
select results_eq(
  $$ select cover_url, cover_thumbhash, cover_dominant, cover_secondary from public.books where isbn13 = '9780140449144' $$,
  $$ values (null::text, null::text, null::text, null::text) $$,
  'import_books stores it without the cover, its thumbhash and its colours');

-- A Manual book from an import keeps its private cover (as the own edition does).
select results_eq(
  $$ select outcome from jsonb_to_recordset(public.import_books('[{"key":"goodreads:catinput3","status":"want_to_read",
        "book":{"title":"Private Cover","authors":["A"],"source":"manual","cover_url":"https://example.com/private.jpg"}}]'::jsonb)) as r(outcome text) $$,
  $$ values ('added') $$,
  'import_books adds a Manual book with her own cover');
select is(
  (select cover_url from public.books where title = 'Private Cover' and owner_id = auth.uid()),
  'https://example.com/private.jpg', 'a Manual book keeps its private cover');

-- ------------------------------------------------------- F17: Open Library keys

select throws_ok(
  $$ select public.add_to_library('{"source":"openlibrary","openlibrary_edition_key":"../../search.json?q=x&limit=1#","title":"Key Probe","authors":["A"]}'::jsonb, 'want_to_read') $$,
  '22023', 'book_invalid', 'a path-traversal edition key is refused');
select throws_ok(
  $$ select public.add_to_library('{"source":"openlibrary","openlibrary_edition_key":"OL990100002M","openlibrary_work_key":"../x","title":"Key Probe","authors":["A"]}'::jsonb, 'want_to_read') $$,
  '22023', 'book_invalid', 'nor a work key that is not one');
select throws_ok(
  $$ select public.add_to_library('{"source":"openlibrary","openlibrary_edition_key":"OL990100002W","title":"Key Probe","authors":["A"]}'::jsonb, 'want_to_read') $$,
  '22023', 'book_invalid', 'an edition key must end in M');
select lives_ok(
  $$ select public.add_to_library('{"source":"openlibrary","openlibrary_edition_key":"OL990100003M","openlibrary_work_key":"OL990100003W","title":"Key Fine","authors":["A"]}'::jsonb, 'want_to_read') $$,
  'Open Library''s own keys are stored');
select results_eq(
  $$ select outcome from jsonb_to_recordset(public.import_books('[{"key":"goodreads:catinput4","status":"want_to_read",
        "book":{"title":"Import Key","authors":["A"],"source":"openlibrary","openlibrary_edition_key":"../../x"}}]'::jsonb)) as r(outcome text) $$,
  $$ values ('failed') $$,
  'import_books refuses the same key');

reset role;
select throws_ok(
  $$ insert into public.books (title, source, openlibrary_edition_key) values ('Direct', 'openlibrary', '../../search.json') $$,
  '23514', null, 'the table refuses an edition key that is not one');
select throws_ok(
  $$ insert into public.books (title, source, apple_id, openlibrary_work_key) values ('Direct', 'apple', '990000100020', 'OL1M') $$,
  '23514', null, 'and a work key that is not one');

select * from finish();
rollback;
