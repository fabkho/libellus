-- The Goodreads cover (20261027020000, 20261027030000): the one allow-list takes Goodreads' image host and
-- nothing that merely starts with it; a Book's cover from there can be filled in; the answer caches hold
-- a cover address only in the shape the function writes:
--   supabase test db

begin;
select plan(13);
set local client_min_messages = warning;

select is(private.cover_allowed('https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/131743446.jpg'), true, 'a Goodreads cover is allowed');
select is(private.cover_allowed('https://i.gr-assets.com'), true, 'the bare host is the host (the rule is the host, then / or nothing)');
select is(private.cover_allowed('http://i.gr-assets.com/images/x.jpg'), false, 'http is not');
select is(private.cover_allowed('https://i.gr-assets.com.evil.com/x.jpg'), false, 'host.evil is not');
select is(private.cover_allowed('https://i.gr-assets.com@evil.example/x.jpg'), false, 'host@evil is not');
select is(private.cover_allowed('https://i.gr-assets.com:80@evil.example/x.jpg'), false, 'host:80@evil is not');
select is(private.cover_allowed('https://evil.example/#@i.gr-assets.com/'), false, 'host in a fragment is not');
select is(private.cover_allowed('https://s.gr-assets.com/x.jpg'), false, 'another gr-assets host is not');
select is(private.cover_allowed('https://covers.openlibrary.org/b/id/1-L.jpg'), true, 'the earlier hosts still are');

-- A Book that entered without a cover can be given a Goodreads one (fill_book_covers, a member who holds it).
create schema if not exists tests;
insert into public.invite_codes (code, label, max_uses) values ('T-GR-COVER', 'goodreads cover test', 5);
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-00000000a0c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ida@grcover.test', '{"invite_code":"T-GR-COVER"}'::jsonb, now(), now(), now());
insert into public.books (title, authors, source, isbn13) values ('Bare', '{A}', 'import', '9783000000059') returning id as bare \gset
insert into public.library_entries (member_id, book_id) values ('00000000-0000-0000-0000-00000000a0c1', :'bare');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-00000000a0c1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  public.fill_book_covers(jsonb_build_array(jsonb_build_object('book_id', :'bare', 'cover_url', 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/131743446.jpg'))),
  1, 'fill_book_covers takes a Goodreads cover');
reset role;
select is((select cover_url from public.books where id = :'bare'), 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1682494830i/131743446.jpg', 'and it is stored');

-- The caches: null (not asked), '' (none), or the address; nothing else.
select lives_ok(
  $$insert into public.goodreads_title_ratings (title_key, status, matched_by, goodreads_id, rating, ratings_count, cover_url)
    values ('a|b', 'found', 'title', '1', 4.1, 10, 'https://i.gr-assets.com/images/x/1.jpg'),
           ('c|d', 'found', 'title', '2', 4.1, 10, '')$$,
  'a cover address, or the empty string for "none", is stored');
select throws_ok(
  $$insert into public.goodreads_title_ratings (title_key, status, matched_by, goodreads_id, rating, ratings_count, cover_url)
    values ('e|f', 'found', 'title', '3', 4.1, 10, 'https://evil.example/1.jpg')$$,
  '23514', null, 'any other address is refused');

select * from finish();
rollback;
