-- Own covers, part 3 (20261109010000_cover_read_path.sql; docs/plans/owned-covers.md §9 PR 3): the read path.
--   supabase test db
--
--   * the Book JSON of the social answers (`private.reading_page_book_json`, `public.member_reading_record`) hands
--     out the stored copy's key and widths exactly where it hands out the cover's URL, and hides both when the
--     cover is hidden (`private.cover_shown`): a hidden cover hides its key too
--   * a Book without a stored copy carries no key, and keeps its URL: the app falls back to /cover, then the source
--   * the cards (`work_card` — the author page, a series sheet, Home's Next in your series —, `series_works` and
--     `author_page`) carry the key of the Book whose cover they show, and none where the cover is the work's or the
--     edition's own (not a Book)
--   * the Library reads `books` through the table itself: its grant covers `cover_key` and `cover_widths`

begin;
select plan(25);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-COVER-READ', 'cover read test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-COVER-READ"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
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

-- A member's claims without leaving the (superuser) role: for the functions whose gating is what is being read.
create or replace function tests.claim(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end;
$$;

create or replace function tests.key(p_n integer)
returns text language sql immutable as $$ select lpad(to_hex(p_n), 32, '0') $$;

-- A cover on an allowed host, by its cover id (the fixtures' own, as everywhere in these tests).
create or replace function tests.cover(p_id integer)
returns text language sql immutable as $$ select 'https://covers.openlibrary.org/b/id/' || p_id || '-L.jpg' $$;

-- The Book JSON of one of her reads, as `member_reading_record` hands it out.
create or replace function tests.record_book(p_member uuid, p_book uuid)
returns jsonb language sql security definer as $$
  select r -> 'entry' -> 'book'
    from jsonb_array_elements(public.member_reading_record(p_member) -> 'reads') r
   where (r -> 'entry' -> 'book' ->> 'id')::uuid = p_book
$$;

-- A work's card, by its title.
create or replace function tests.card(p_title text, p_language text default 'en')
returns jsonb language sql security definer as $$
  select public.work_card((select id from public.works where title = p_title), p_language)
$$;

-- One card out of a `series_works` / `author_page` answer, by its title.
create or replace function tests.card_of(p_answer jsonb, p_array text, p_title text)
returns jsonb language sql immutable as $$
  select card from jsonb_array_elements(p_answer -> p_array) card where card ->> 'title' = p_title
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- Whatever else is in this database is checked already: the reads below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;
update private.social_config set settle_window = interval '0';

select tests.member('ada@cover-read.pgtap.test') as ada \gset
select tests.member('ben@cover-read.pgtap.test') as ben \gset

-- ------------------------------------------------------------------ fixtures

-- Her Book with a cover we have stored (A), one with a cover we have not stored yet (C), and one that only the
-- cards see (D).
select tests.act_as(:'ada');
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Stored Cover', 'authors', jsonb_build_array('An Author'),
  'source', 'apple', 'apple_id', '9800000101', 'isbn13', '9780000100016', 'cover_url', tests.cover(7101),
  'cover_thumbhash', 'abc'), 'reading', current_date - 3)).id as entry_a \gset
select public.finish_reading(:'entry_a', current_date, 18, null);
select (public.add_to_library(jsonb_build_object('title', 'Pgtap No Stored Cover', 'authors', jsonb_build_array('An Author'),
  'source', 'apple', 'apple_id', '9800000102', 'isbn13', '9780000100023', 'cover_url', tests.cover(7102)),
  'reading', current_date - 3)).id as entry_c \gset
select public.finish_reading(:'entry_c', current_date, 18, null);
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Her Card', 'authors', jsonb_build_array('An Author'),
  'source', 'apple', 'apple_id', '9800000103', 'isbn13', '9780000100030', 'cover_url', tests.cover(7103)),
  'want_to_read', null)).id as entry_d \gset

reset role;

select book_id as book_a from public.library_entries where id = :'entry_a' \gset
select book_id as book_c from public.library_entries where id = :'entry_c' \gset
select book_id as book_d from public.library_entries where id = :'entry_d' \gset

-- A Book of hers with a cover that is NOT on the allow-list (B): a Manual Book's cover is any https address
-- (`use_own_edition`), and `private.cover_shown` says no. It is the hidden cover of the two tests below: it has a
-- stored copy in the row, which must not come out.
insert into public.books (title, authors, cover_url, source, owner_id)
values ('Pgtap Off List Cover', array['An Author'], 'https://example.org/off-list.jpg', 'manual', :'ada')
returning id as book_b \gset
insert into public.library_entries (member_id, book_id, status)
values (:'ada', :'book_b', 'want_to_read') returning id as entry_b \gset
select tests.act_as(:'ada');
select public.start_reading(:'entry_b', current_date - 3);
select public.finish_reading(:'entry_b', current_date, 18, null);
reset role;

-- The stored copies, as the store function writes them (cover_store_done, PR 1): A, B (deliberately: the gating is
-- what must hide it) and D. C has none, as a Book whose store has not run yet.
update public.books set cover_key = tests.key(1), cover_widths = '{240,600}' where id = :'book_a';
update public.books set cover_key = tests.key(2), cover_widths = '{120}' where id = :'book_b';
update public.books set cover_key = tests.key(3), cover_widths = '{600}' where id = :'book_d';

-- ------------------------------------------------------------------ works

insert into public.authors (wikidata_id, name, fetched_at, works_fetched_at)
values ('Q99000101', 'Pgtap Cover Author', now(), now()) returning id as au \gset

-- W1: her Book A's work (the card opens her Book).
insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at)
values ('OL9920101W', 'Pgtap Read Card Work', 2010, 'novel', tests.cover(7110), '{}'::jsonb, now())
returning id as work_1 \gset
insert into public.work_authors (work_id, author_id) values (:'work_1', :'au');
insert into public.book_works (book_id, work_id, matched_by) values (:'book_a', :'work_1', 'isbn');

-- W2: a work with a cover of its own and no Book of hers (the card shows the work's cover, which has no key).
insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at)
values ('OL9920102W', 'Pgtap Work Own Cover', 2011, 'novel', tests.cover(7111), '{}'::jsonb, now())
returning id as work_2 \gset
insert into public.work_authors (work_id, author_id) values (:'work_2', :'au');

-- W3: a work whose edition is in the Catalogue with a Book of another member's (the card opens that Book, so it
-- carries that Book's key). She has no entry for it.
insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at)
values ('OL9920103W', 'Pgtap Catalogued Card Work', 2012, null, tests.cover(7112),
        jsonb_build_object('en', jsonb_build_object('title', 'Pgtap Catalogued Card Work', 'isbn13', '9780000100047',
          'openlibrary_edition_key', 'OL9920103M', 'cover_url', tests.cover(7113))), now())
returning id as work_3 \gset
insert into public.work_authors (work_id, author_id) values (:'work_3', :'au');

select tests.act_as(:'ben');
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Catalogued Card Work', 'authors', jsonb_build_array('An Author'),
  'source', 'openlibrary', 'openlibrary_edition_key', 'OL9920103M', 'isbn13', '9780000100047',
  'cover_url', tests.cover(7114)), 'want_to_read', null)).book_id as book_cat \gset
reset role;

update public.books set cover_key = tests.key(4), cover_widths = '{120,240}' where id = :'book_cat';

-- D is credited to the author without a work link: the "Other" card of her own Book on the author page.
insert into public.book_authors (book_id, author_id, position) values (:'book_d', :'au', 1);

-- ------------------------------------------------------------------ her page

select tests.act_as(:'ada');
select public.set_private(false);
select public.set_reading_page(true);
select public.share_book_card(:'book_a', true);
select public.set_entry_series(:'entry_d', null, 'Pgtap Read Series', null) is not null as placed \gset
-- Her follower, who reads her record below (member_reading_record is another member's reads, not her own).
select tests.act_as(:'ben');
select public.follow(:'ada') is not null as follows \gset
reset role;

select id as series from public.series where created_by = :'ada' and name = 'Pgtap Read Series' \gset
select token from public.reading_pages where member_id = :'ada' \gset

-- ------------------------------------------------- the Book JSON of the social answers

-- The feed, a profile and a friend's page read her Book JSON as her follower (ben): the two copies of the object
-- are gated the same, so both are read here.
select tests.claim(:'ben');

select is(tests.record_book(:'ada', :'book_a') ->> 'cover_url', tests.cover(7101),
  'member_reading_record: the Book''s cover, as before');
select is(tests.record_book(:'ada', :'book_a') ->> 'cover_key', tests.key(1),
  'member_reading_record: and the key of our stored copy, in the same Book');
select is(tests.record_book(:'ada', :'book_a') -> 'cover_widths', '[240, 600]'::jsonb,
  'member_reading_record: with the real widths stored, so the client''s srcset is exact');
select is(tests.record_book(:'ada', :'book_c') ->> 'cover_url', tests.cover(7102),
  'a Book whose cover is not stored yet keeps its URL …');
select is(tests.record_book(:'ada', :'book_c') ->> 'cover_key', null,
  '… and carries no key: the app falls back to /cover, then the source');
select is(tests.record_book(:'ada', :'book_b') ->> 'cover_url', null,
  'a cover off the allow-list is hidden (private.cover_shown), as before …');
select is(tests.record_book(:'ada', :'book_b') ->> 'cover_key', null,
  '… and its key is hidden with it, though the Book has one');
select is(tests.record_book(:'ada', :'book_b') ->> 'cover_widths', null,
  '… its widths too: the hidden cover says nothing about its stored copy');

select is(private.reading_page_book_json(b) ->> 'cover_key', tests.key(1),
  'reading_page_book_json (the feed, a profile, the public page): the stored copy''s key')
  from public.books b where b.id = :'book_a';
select is(private.reading_page_book_json(b) ->> 'cover_key', null,
  'reading_page_book_json: and none for a cover that is hidden')
  from public.books b where b.id = :'book_b';

-- The public reading page's card, read as a stranger (anon).
select tests.act_anon();
select is(public.public_book_card(:'token', :'book_a') -> 'book' ->> 'cover_key', tests.key(1),
  'a public Book card hands the key to a visitor of her reading page');
select is(public.public_book_card(:'token', :'book_a') -> 'book' -> 'cover_widths', '[240, 600]'::jsonb,
  'and its widths');

-- ---------------------------------------------------------------------- the cards

reset role;
select tests.claim(:'ada');

select is(tests.card('Pgtap Read Card Work') ->> 'coverUrl', tests.cover(7101),
  'a work''s card shows her Book''s cover …');
select is(tests.card('Pgtap Read Card Work') ->> 'coverKey', tests.key(1),
  '… and that same Book''s stored copy: one picture, key and URL together');
select is(tests.card('Pgtap Read Card Work') -> 'coverWidths', '[240, 600]'::jsonb, 'with its widths');
select is(tests.card('Pgtap Work Own Cover') ->> 'coverUrl', tests.cover(7111),
  'a card whose cover is the work''s own (no Book of hers) …');
select is(tests.card('Pgtap Work Own Cover') ? 'coverKey', false,
  '… carries no key: that picture is not a Book''s, so we store nothing of it');
select is(tests.card('Pgtap Catalogued Card Work') ->> 'coverKey', tests.key(4),
  'a card that opens the Catalogue''s Book of its edition carries that Book''s key');
select is(tests.card('Pgtap Catalogued Card Work') ->> 'coverUrl', tests.cover(7114),
  'and that Book''s URL, not the edition''s own');

select is(tests.card_of(public.series_works(:'series'), 'works', 'Pgtap Her Card') ->> 'coverKey', tests.key(3),
  'a series sheet''s card of her own Book carries its stored copy');
select is(tests.card_of(public.series_works(:'series'), 'works', 'Pgtap Her Card') ->> 'coverUrl', tests.cover(7103),
  'with the cover it already showed');

select is(tests.card_of(public.author_page('Q99000101'), 'other', 'Pgtap Her Card') ->> 'coverKey', tests.key(3),
  'an author page''s "Other" card of her own Book carries its stored copy');
select is(tests.card_of(public.author_page('Q99000101'), 'other', 'Pgtap Her Card') ->> 'coverUrl', tests.cover(7103),
  'with the cover it already showed');

-- ------------------------------------------------------------------ the Library

select tests.act_as(:'ada');
select is((select cover_key from public.books where id = :'book_a'), tests.key(1),
  'the Library reads books through the table: its grant covers cover_key');
select is((select cover_widths from public.books where id = :'book_a'), '{240,600}'::smallint[],
  'and cover_widths');

select * from finish();
rollback;
