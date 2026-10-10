-- A Book the check could not confirm is shown to no one but those who have it (social v2a contract §5;
-- review HIGH 2):
--   supabase test db
--
-- check_failed means nothing vouches for the row's text: the source does not know the Book, or its
-- answer is not this Book. For anyone but a member with the Book in her own Library, every answer that
-- hands a Book to others (the feed, a profile, Want to read, her reading record, the public reading
-- page and its cards, the search) gives it as title null, authors [], no cover, no description,
-- "unverified": true (search leaves it out). An unchecked Book keeps today's rule (title and author, no
-- description); a checked Book is shown whole.

begin;
select plan(30);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-FAILED-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-FAILED-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.record_book(p_member uuid, p_book uuid)
returns jsonb language sql security definer as $$
  select r -> 'entry' -> 'book'
    from jsonb_array_elements(public.member_reading_record(p_member) -> 'reads') r
   where (r -> 'entry' -> 'book' ->> 'id')::uuid = p_book
$$;
grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;
update private.social_config set settle_window = interval '0';

insert into ids values
  ('ada', tests.member('ada@failed.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@failed.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@failed.pgtap.test', 'Cy'));

select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(false);
select public.set_reading_page(true);
select tests.act_as((select id from ids where name = 'ben'));
select public.follow((select id from ids where name = 'ada'));

select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('failed',  (public.add_to_library(tests.snap('Planted Book') || '{"isbn13":"9780141439518"}', 'reading', current_date - 3)).id),
  ('pending', (public.add_to_library(tests.snap('Pending Book'), 'reading', current_date - 3)).id),
  ('good',    (public.add_to_library(tests.snap('Good Book'), 'reading', current_date - 3)).id),
  ('wanted',  (public.add_to_library(tests.snap('Wanted Planted'), 'want_to_read', null)).id);
select public.finish_reading((select id from ids where name = 'failed'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'pending'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'good'), current_date, 18, null);
insert into links values ('page', (select token from public.reading_pages where member_id = (select id from ids where name = 'ada')));

reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('failed', 'pending', 'good', 'wanted');
select public.catalogue_check_miss((select id from ids where name = 'b_failed'));
select public.catalogue_check_miss((select id from ids where name = 'b_wanted'));
select public.catalogue_check_save((select id from ids where name = 'b_good'), jsonb_build_object(
  'title', 'Good Book', 'authors', jsonb_build_array('Real Author'), 'description', 'Real blurb',
  'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/x/600x900bb.jpg'));

-- A cover of hers on an allowed host: it must not survive on a failed Book either.
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/777-L.jpg' where id = (select id from ids where name = 'b_failed');

-- ------------------------------------------------------------ the helper

select tests.act_anon();
reset role;
select is(private.book_shown((select b from public.books b where b.id = (select id from ids where name = 'b_failed'))), false,
  'a failed Book is not shown (to nobody, outside a Library)');
select is(private.book_shown((select b from public.books b where b.id = (select id from ids where name = 'b_pending'))), true, 'an unchecked Book is');
select is(private.book_shown((select b from public.books b where b.id = (select id from ids where name = 'b_good'))), true, 'and a checked one');

-- ------------------------------------- her record, the feed, her profile, her want list: as Ben

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_failed')),
  jsonb_build_object('id', (select id from ids where name = 'b_failed'), 'created_at', (select created_at from public.books where id = (select id from ids where name = 'b_failed')),
    'title', null, 'authors', '[]'::jsonb, 'isbn13', null, 'isbn10', null, 'page_count', null, 'published_year', null, 'language', null,
    'publisher', null, 'description', null, 'cover_url', null, 'cover_thumbhash', null, 'cover_dominant', null, 'cover_secondary', null,
    'source', 'apple', 'apple_id', null, 'openlibrary_edition_key', null, 'openlibrary_work_key', null, 'format', null, 'goodreads', null,
    'unverified', true),
  'her record gives a failed Book as nothing a member sent: no title, authors, ISBN, cover, description, source id: unverified');
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_pending')) ->> 'title', 'Pending Book',
  'an unchecked Book keeps its title in her record');
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_pending')) -> 'description', 'null'::jsonb,
  'and has no description');
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_good')) ->> 'description', 'Real blurb',
  'a checked Book is shown whole');
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_good')) -> 'unverified', null::jsonb,
  'and is not marked');

select ok(position('Planted Book' in public.feed()::text) = 0, 'the feed never names a failed Book''s title');
select ok(exists (select 1 from jsonb_array_elements(public.feed()) i where i -> 'book' ->> 'id' = (select id::text from ids where name = 'b_failed'))
          and not exists (select 1 from jsonb_array_elements(public.feed()) i
                           where i -> 'book' ->> 'id' = (select id::text from ids where name = 'b_failed')
                             and not ((i -> 'book' -> 'unverified') = 'true'::jsonb and i -> 'book' -> 'title' = 'null'::jsonb
                                      and i -> 'book' -> 'authors' = '[]'::jsonb and i -> 'book' -> 'cover_url' = 'null'::jsonb)),
  'it hands the Book as unverified: no title, no authors, no cover');
select ok(position('Pending Book' in public.feed()::text) > 0 and position('Good Book' in public.feed()::text) > 0,
  'an unchecked and a checked Book are named');
select ok(position('Planted Book' in public.member_profile((select id from ids where name = 'ada'))::text) = 0
          and position('/b/id/777-L' in public.member_profile((select id from ids where name = 'ada'))::text) = 0
          and position('unverified' in public.member_profile((select id from ids where name = 'ada'))::text) > 0,
  'her profile gives it unverified, its cover too');
select ok(position('Wanted Planted' in public.member_want((select id from ids where name = 'ada'))::text) = 0
          and position('unverified' in public.member_want((select id from ids where name = 'ada'))::text) > 0,
  'and so does her Want to read');

-- The search leaves it out; an ISBN search too.
select is((select count(*)::int from public.search_books('Planted Book')), 0, 'the search does not return a failed Book to a member who does not have it');
select is((select count(*)::int from public.search_books('9780141439518')), 0, 'nor by its ISBN');
select is((select count(*)::int from public.search_books('Pending Book')), 1, 'an unchecked one is found');

-- --------------------------------------------------- the public reading page and its cards

select tests.act_anon();
select ok(position('Planted Book' in public.public_reading_page((select link from links where name = 'page'))::text) = 0
          and position('/b/id/777-L' in public.public_reading_page((select link from links where name = 'page'))::text) = 0,
  'the public reading page does not show a failed Book''s title or cover');
select ok(position('unverified' in public.public_reading_page((select link from links where name = 'page'))::text) > 0,
  'it is there as unverified');
select ok(position('Good Book' in public.public_reading_page((select link from links where name = 'page'))::text) > 0
          and position('Pending Book' in public.public_reading_page((select link from links where name = 'page'))::text) > 0,
  'a checked and an unchecked Book are named');
select is(public.public_book_card((select link from links where name = 'page'), (select id from ids where name = 'b_failed')) -> 'book' ->> 'title', null,
  'the card of a failed Book has no title');
select is(public.public_book_card((select link from links where name = 'page'), (select id from ids where name = 'b_failed')) -> 'book' -> 'unverified', 'true'::jsonb,
  'it is unverified');

-- --------------------------------------------- the member who has it sees her own row

select tests.act_as((select id from ids where name = 'ada'));
select is((select title from public.books where id = (select id from ids where name = 'b_failed')), 'Planted Book',
  'she reads her own row as she added it');
select is((select count(*)::int from public.search_books('Planted Book')), 1, 'and finds it in the search');
select is((select count(*)::int from public.search_books('9780141439518')), 1, 'and by its ISBN');

-- Ben has the same Book in his own Library: it is his row too, and he is shown it.
select tests.act_as((select id from ids where name = 'ben'));
select is((public.add_to_library(tests.snap('Planted Book') || '{"isbn13":"9780141439518"}', 'want_to_read', null)).id is not null, true,
  'Ben adds the same Book (by its ISBN: the same row)');
select is((select count(*)::int from public.search_books('Planted Book')), 1, 'he now finds it');
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_failed')) ->> 'title', 'Planted Book',
  'and Ada''s record shows it to him as it is stored: he has it in his own Library');

-- You both read (social v2a): hers is a failed Book that shares a work key with one he finished: handed unverified.
select tests.act_as((select id from ids where name = 'ada'));
insert into ids values ('wk', (public.add_to_library(tests.snap('Shared Work A') || '{"source":"openlibrary","apple_id":null,"openlibrary_edition_key":"OL5551M","openlibrary_work_key":"OL5551W"}', 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'wk'), current_date, 18, null);
reset role;
select public.catalogue_check_miss(tests.book_of((select id from ids where name = 'wk')));
select tests.act_as((select id from ids where name = 'ben'));
insert into ids values ('wkb', (public.add_to_library(tests.snap('Shared Work B') || '{"source":"openlibrary","apple_id":null,"openlibrary_edition_key":"OL5552M","openlibrary_work_key":"OL5551W"}', 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'wkb'), current_date, 18, null);
select ok(exists (select 1 from jsonb_array_elements(public.both_read((select id from ids where name = 'ada'))) b
                   where b -> 'book' ->> 'id' = tests.book_of((select id from ids where name = 'wk'))::text
                     and b -> 'book' -> 'unverified' = 'true'::jsonb and b -> 'book' -> 'title' = 'null'::jsonb),
  'you both read hands a failed Book of hers as unverified');
select ok(position('Shared Work A' in public.both_read((select id from ids where name = 'ada'))::text) = 0, 'without its title');

select tests.act_as((select id from ids where name = 'cy'));
select is(tests.record_book((select id from ids where name = 'ada'), (select id from ids where name = 'b_failed')) -> 'unverified', 'true'::jsonb,
  'Cy, who has not got it, reads it unverified too (her account is public)');

select * from finish();
rollback;
