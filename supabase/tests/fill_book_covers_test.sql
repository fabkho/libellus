-- fill_book_covers (20261027010000_fill_book_covers.sql): a Catalogue Book that entered without a cover can
-- get one afterwards, from a member who holds it, never replacing a cover that is there, only from the
-- allow-list:
--   supabase test db

begin;
select plan(24);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-FILL-COVER', 'fill cover test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-FILL-COVER"}'::jsonb, now(), now(), now());
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

select tests.member('ida@fillcover.test') as ida_id \gset
select tests.member('max@fillcover.test') as max_id \gset

insert into public.books (title, authors, source, isbn13) values ('Bare One', '{A}', 'import', '9783000000011') returning id as bare_one \gset
insert into public.books (title, authors, source, isbn13) values ('Bare Two', '{A}', 'import', '9783000000028') returning id as bare_two \gset
insert into public.books (title, authors, source, isbn13, cover_url) values ('Has One', '{A}', 'import', '9783000000035', 'https://covers.openlibrary.org/b/id/1-L.jpg') returning id as has_one \gset
insert into public.books (title, authors, source, isbn13) values ('Not Hers', '{A}', 'import', '9783000000042') returning id as not_hers \gset
insert into public.books (title, authors, source, owner_id) values ('Her Own', '{A}', 'manual', :'ida_id') returning id as manual_one \gset
insert into public.library_entries (member_id, book_id) values (:'ida_id', :'bare_one'), (:'ida_id', :'bare_two'), (:'ida_id', :'has_one'), (:'ida_id', :'manual_one');
insert into public.library_entries (member_id, book_id) values (:'max_id', :'not_hers');

-- ---------------------------------------------------------------- who may call

select tests.act_as(:'ida_id');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'bare_one', 'cover_url', 'https://covers.openlibrary.org/b/id/42-L.jpg',
    'cover_thumbhash', 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rg==', 'cover_dominant', '#112233', 'cover_secondary', '#AABBCC'))),
  1, 'a member who holds a Book without a cover gives it one');

reset role;
select is((select cover_url from public.books where id = :'bare_one'), 'https://covers.openlibrary.org/b/id/42-L.jpg', 'the cover is stored');
select is((select cover_thumbhash from public.books where id = :'bare_one'), 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rg==', 'with its thumbhash');
select is((select (cover_dominant, cover_secondary)::text from public.books where id = :'bare_one'), '(#112233,#aabbcc)', 'and its two colours, lowercased');

select tests.act_as(:'ida_id');

-- ------------------------------------------------- by ISBN, when the caller has only a snapshot

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'isbn13', '978-3-00-000002-8', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg'))),
  1, 'a Book is found by its ISBN-13 too (hyphens ignored)');

-- ------------------------------------------------------------- what it never does

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'has_one', 'cover_url', 'https://covers.openlibrary.org/b/id/99-L.jpg'))),
  0, 'a cover that is there is never replaced');
select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'not_hers', 'cover_url', 'https://covers.openlibrary.org/b/id/7-L.jpg'))),
  0, 'a Book she does not hold is not hers to decorate');
select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'manual_one', 'cover_url', 'https://covers.openlibrary.org/b/id/7-L.jpg'))),
  0, 'a Manual book is not a Catalogue Book');

-- A new bare Book of hers for the refusals below.
reset role;
insert into public.books (title, authors, source, isbn13) values ('Bare Three', '{A}', 'import', '9783000000059') returning id as bare_three \gset
insert into public.library_entries (member_id, book_id) values (:'ida_id', :'bare_three');
select tests.act_as(:'ida_id');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object('book_id', :'bare_three', 'cover_url', 'https://evil.example/pixel.gif'))),
  0, 'a cover off the allow-list is left out, not an error');
select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object('book_id', :'bare_three', 'cover_url', 'http://covers.openlibrary.org/b/id/1-L.jpg'))),
  0, 'http is left out');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'bare_three', 'cover_url', 'https://covers.openlibrary.org/b/id/5-L.jpg',
    'cover_thumbhash', '<script>', 'cover_dominant', 'red', 'cover_secondary', '#00ff00'))),
  1, 'a malformed thumbhash or colour is dropped, the cover stays');
reset role;
select is((select (cover_thumbhash is null and cover_dominant is null and cover_secondary is null) from public.books where id = :'bare_three'), true, 'no thumbhash, no colours (one colour is none)');

select tests.act_as(:'ida_id');
select throws_ok($$ select public.fill_book_covers('{"not":"an array"}'::jsonb) $$, '22023', null, 'not an array is refused');

reset role;
select tests.act_as(null);
select throws_ok($$ select public.fill_book_covers('[]'::jsonb) $$, '28000', null, 'signed out is refused');

-- ------------------------------------------- the import's one-time Apple upgrade (`replaces`, 20261101010000)

reset role;
insert into public.books (title, authors, source, isbn13, cover_url) values ('Small One', '{A}', 'import', '9783000000066', 'https://covers.openlibrary.org/b/id/11-L.jpg') returning id as small_one \gset
insert into public.books (title, authors, source, isbn13, cover_url) values ('Linked One', '{A}', 'import', '9783000000073', 'https://i.gr-assets.com/images/S/books/1i/5.jpg') returning id as linked_one \gset
insert into public.books (title, authors, source, isbn13, cover_url) values ('Else Not Hers', '{A}', 'import', '9783000000080', 'https://covers.openlibrary.org/b/id/12-L.jpg') returning id as else_not_hers \gset
insert into public.library_entries (member_id, book_id) values (:'ida_id', :'small_one'), (:'ida_id', :'linked_one');
insert into public.library_entries (member_id, book_id) values (:'max_id', :'else_not_hers');
select tests.act_as(:'ida_id');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'small_one', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg',
    'replaces', 'https://covers.openlibrary.org/b/id/11-L.jpg'))),
  1, 'an upgrade replaces the cover the caller saw with an Apple artwork');
reset role;
select is((select cover_url from public.books where id = :'small_one'), 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg', 'the Book has the Apple cover');
select tests.act_as(:'ida_id');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'small_one', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/y/600x900bb.jpg',
    'replaces', 'https://covers.openlibrary.org/b/id/11-L.jpg'))),
  0, 'the same upgrade twice changes nothing: the Book no longer has the cover it replaces');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'linked_one', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/z/600x900bb.jpg',
    'replaces', 'https://covers.openlibrary.org/b/id/999-L.jpg'))),
  0, 'a cover that is not the one the caller saw (another member upgraded it, or it changed) stays');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'linked_one', 'cover_url', 'https://covers.openlibrary.org/b/id/77-L.jpg',
    'replaces', 'https://i.gr-assets.com/images/S/books/1i/5.jpg'))),
  0, 'an upgrade is only ever Apple artwork: another host is not a larger cover');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'else_not_hers', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/w/600x900bb.jpg',
    'replaces', 'https://covers.openlibrary.org/b/id/12-L.jpg'))),
  0, 'a Book she does not hold is not hers to upgrade');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'book_id', :'manual_one', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/w/600x900bb.jpg',
    'replaces', 'https://covers.openlibrary.org/b/id/12-L.jpg'))),
  0, 'a Manual book is not a Catalogue Book: never upgraded');

select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object(
    'isbn13', '9783000000073', 'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/z/600x900bb.jpg',
    'cover_thumbhash', 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rg==',
    'replaces', 'https://i.gr-assets.com/images/S/books/1i/5.jpg'))),
  1, 'a linked Goodreads cover is replaced by the Apple one (the snapshot named by its ISBN)');
reset role;
select is((select cover_thumbhash from public.books where id = :'linked_one'), 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rg==', 'with the new thumbhash');
select is((select cover_url from public.books where id = :'has_one'), 'https://covers.openlibrary.org/b/id/1-L.jpg', 'a cover without `replaces` is still never replaced');

select * from finish();
rollback;
