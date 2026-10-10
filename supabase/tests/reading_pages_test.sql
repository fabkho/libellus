-- Share with friends: the reading page and Book cards (issue #171):
--   supabase test db
--
-- The page is off until she turns it on; on, it has a 22-character token, and
-- anyone (signed out included) reads it through `public_reading_page(token)`.
-- What comes back is only the sections she turned on, and never her address,
-- her id, the reason she abandoned a Book, a highlight or its note, or a review
-- she did not share. Turning the page off, or a new link, kills the old token:
-- it reads as null (the page 404s). A Book's card exists for a Book she shared
-- or one her page shows, never for another Book of her Library or anybody
-- else's. Her shelf is Regal's for the owner of the published shelf (#110) and
-- a row of covers for anyone else. Only she reads or writes her settings.
-- Assertions ask about the rows this test made, never about how many rows a
-- table holds.

begin;
select plan(49);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-RPAGES', 'reading pages test', 5);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-RPAGES', 'name', p_name)), now(), now(), now());
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

-- A Book in a member's Library: its entry id.
create or replace function tests.entry(p_member uuid, p_title text)
returns uuid language plpgsql as $$
declare v_book uuid; v_entry uuid;
begin
  insert into public.books (title, authors, source, apple_id, cover_url)
  values (p_title, array['An Author'], 'apple', (floor(random() * 1e9))::bigint::text, 'https://covers.openlibrary.org/b/' || p_title || '.jpg')
  returning id into v_book;
  insert into public.library_entries (member_id, book_id) values (p_member, v_book) returning id into v_entry;
  return v_entry;
end;
$$;

-- Past RLS: the Book of an entry, asked as anybody.
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, anon;
create temporary table tokens (name text primary key, token text) on commit drop;
grant all on tokens to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@rpages.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@rpages.pgtap.test'));

-- Ada's Library: one she reads, one finished this year with a 5-star Rating and a
-- review, one finished with 3 stars and a review she will not share, one abandoned
-- with a reason, one she only wants to read.
insert into ids values
  ('reading', tests.entry((select id from ids where name = 'ada'), 'Reading Now')),
  ('loved', tests.entry((select id from ids where name = 'ada'), 'Loved It')),
  ('meh', tests.entry((select id from ids where name = 'ada'), 'Meh Book')),
  ('dropped', tests.entry((select id from ids where name = 'ada'), 'Dropped Book')),
  ('wanted', tests.entry((select id from ids where name = 'ada'), 'Wanted Book')),
  ('bens', tests.entry((select id from ids where name = 'ben'), 'Bens Book'));

insert into public.reading_sessions (entry_id, started_on) values ((select id from ids where name = 'reading'), current_date - 3);
insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review)
values ((select id from ids where name = 'loved'), date_trunc('year', now())::date, date_trunc('year', now())::date + 1, 'finished', 20, 'LOVED-REVIEW-TEXT'),
       ((select id from ids where name = 'meh'), date_trunc('year', now())::date, date_trunc('year', now())::date + 2, 'finished', 12, 'MEH-SECRET-REVIEW');
insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, abandon_reason)
values ((select id from ids where name = 'dropped'), current_date - 30, current_date - 20, 'abandoned', 'ABANDON-SECRET-REASON');
insert into public.reader_highlights (id, member_id, entry_id, file_hash, cfi, section_index, color, excerpt, note)
values (gen_random_uuid(), (select id from ids where name = 'ada'), (select id from ids where name = 'loved'),
        repeat('a', 64), 'epubcfi(/6/2)', 0, 'lamp', 'HIGHLIGHT-SECRET-WORDS', 'NOTE-SECRET-TEXT');

-- ------------------------------------------------------------- off by default

select tests.act_as((select id from ids where name = 'ada'));

select is((select count(*)::int from public.reading_pages), 0, 'a member has no reading page until she turns it on');

select is((select token from public.set_reading_page(false)), null, 'turned off, a page has no token');

insert into tokens select 'first', token from public.set_reading_page(true);
select ok((select token from tokens where name = 'first') ~ '^[A-Za-z0-9_-]{22}$', 'turned on, it gets a 22-character token');
select is((select token from public.set_reading_page(true)), (select token from tokens where name = 'first'),
  'turning it on again keeps its address');

-- ------------------------------------------------------------ what anyone sees

select tests.act_anon();

select ok(public.public_reading_page((select token from tokens where name = 'first')) is not null, 'signed out, the page reads by its token');
select is(public.public_reading_page('AAAAAAAAAAAAAAAAAAAAAA'), null, 'an unknown token reads as nothing');
select is(public.public_reading_page('short'), null, 'and so does one of the wrong shape');
select is(public.public_reading_page((select token from tokens where name = 'first')) ->> 'name', 'Ada', 'the page carries her first name');

create temporary table page as select public.public_reading_page((select token from tokens where name = 'first')) as p;

select is((select jsonb_array_length(p -> 'reading') from page), 1, 'Currently reading: her Book being read');
select is((select p -> 'reading' -> 0 -> 'book' ->> 'title' from page), 'Reading Now', 'by its title');
select is((select (p -> 'year' ->> 'books')::int from page), 2, 'This year: the Books finished this year');
select is((select jsonb_array_length(p -> 'year' -> 'months') from page), 12, 'and a month row of twelve');
select is((select (p -> 'year' -> 'months' ->> 0)::int from page), 2, 'both in January');
select is((select jsonb_array_length(p -> 'favourites') from page), 1, 'Favourites: only what she rated 4 stars and up');
select is((select (p -> 'favourites' -> 0 ->> 'rating')::int from page), 20, 'with its Rating');
select is((select jsonb_array_length(p -> 'finished') from page), 2, 'Recently finished: her finished Books');
select is((select p -> 'shelf' ->> 'kind' from page), 'covers', 'her shelf, not the owner''s: a row of covers');
select is((select jsonb_array_length(p -> 'shelf' -> 'books') from page), 2, 'of the Books she finished');

select ok((select p::text from page) !~ 'rpages\.pgtap\.test', 'never her address');
select ok((select p::text from page) !~ (select id::text from ids where name = 'ada'), 'never her id');
select ok((select p::text from page) !~ 'SECRET', 'never an unshared review, an abandon reason, a highlight or a note');
select ok((select p::text from page) !~ 'LOVED-REVIEW-TEXT', 'not even the good review, while she has not shared it');
select ok((select p::text from page) !~ 'Wanted Book|Dropped Book', 'nor a Book no section shows');

-- ----------------------------------------------------------- only her sections

select tests.act_as((select id from ids where name = 'ada'));
select throws_ok($$select public.set_reading_page_sections('{"reading": "no"}')$$, '22023', 'reading_page_sections_invalid', 'a section is switched with a boolean');
select throws_ok($$select public.set_reading_page_sections('{"email": true}')$$, '22023', 'reading_page_sections_invalid', 'and only the five sections exist');
select is((select show_finished from public.set_reading_page_sections('{"finished": false, "year": false}')), false, 'she turns sections off');

select tests.act_anon();
select ok(not (public.public_reading_page((select token from tokens where name = 'first')) ? 'finished'), 'a section turned off is not in the page at all');
select ok(not (public.public_reading_page((select token from tokens where name = 'first')) ? 'year'), 'nor are its figures');
select ok(public.public_reading_page((select token from tokens where name = 'first')) ? 'favourites', 'the others stay');
select is(public.public_reading_page((select token from tokens where name = 'first')) -> 'sections' -> 'finished', 'false'::jsonb, 'the page says which sections are off');

-- ----------------------------------------------------------------- Book cards

select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'loved'))) -> 'book' ->> 'title',
  'Loved It', 'a Book her page shows has a card');
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'wanted'))),
  null, 'a Book of her Library the page does not show has none');
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'bens'))),
  null, 'nor has anybody else''s Book');

select tests.act_as((select id from ids where name = 'ada'));
select is((select review from public.share_book_card(tests.book_of((select id from ids where name = 'wanted')), false)), false, 'she shares a Book');
select throws_ok(format('select public.share_book_card(%L, true)', tests.book_of((select id from ids where name = 'bens'))),
  'P0002', 'entry_not_found', 'only one of her own');
select is((select review from public.share_book_card(tests.book_of((select id from ids where name = 'loved')), true)), true, 'and the review of another');

select tests.act_anon();
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'wanted'))) ->> 'status',
  'want_to_read', 'the shared Book has its card now');
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'loved'))) ->> 'review',
  'LOVED-REVIEW-TEXT', 'the shared review is on the card');
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'meh'))) ->> 'review',
  null, 'a Book her shelf shows has a card, without the review she did not share');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_reading_page_sections('{"shelf": false}');
select tests.act_anon();
select is(public.public_book_card((select token from tokens where name = 'first'), tests.book_of((select id from ids where name = 'meh'))),
  null, 'with Recently finished and the shelf off, a Book only they showed has no card');

-- ------------------------------------------------------------------ hers only

select tests.act_as((select id from ids where name = 'ben'));
select is((select count(*)::int from public.reading_pages), 0, 'another member reads none of her settings');
select is((select count(*)::int from public.reading_page_books), 0, 'nor her shared Books');
select throws_ok($$select public.renew_reading_page_link()$$, '22023', 'reading_page_off', 'a member without a page gets no link');

select tests.act_anon();
select throws_ok($$select public.set_reading_page(true)$$, '42501', null, 'signed out, nobody turns a page on');
select throws_ok($$select * from public.reading_pages$$, '42501', null, 'nor reads the settings');

-- --------------------------------------------------------------------- revoke

select tests.act_as((select id from ids where name = 'ada'));
insert into tokens select 'renewed', token from public.renew_reading_page_link();
select tests.act_anon();
select is(public.public_reading_page((select token from tokens where name = 'first')), null, 'a new link: the old one reads as nothing');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_reading_page(false);
select tests.act_anon();
select is(public.public_reading_page((select token from tokens where name = 'renewed')), null, 'turned off: its link reads as nothing');
select is(public.public_book_card((select token from tokens where name = 'renewed'), tests.book_of((select id from ids where name = 'wanted'))),
  null, 'and nor do its cards');

-- ----------------------------------------------------------- the owner's shelf

reset role;
update private.shelf_publish set owner_id = (select id from ids where name = 'ada');
select tests.act_as((select id from ids where name = 'ada'));
insert into tokens select 'owner', token from public.set_reading_page(true);
select public.set_reading_page_sections('{"shelf": true}');
select tests.act_anon();
select is(public.public_reading_page((select token from tokens where name = 'owner')) -> 'shelf', '{"kind": "regal"}'::jsonb,
  'the owner''s shelf is Regal''s, with nothing of her Library in it');

select * from finish();
rollback;
