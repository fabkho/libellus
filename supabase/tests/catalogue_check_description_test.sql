-- A description is read through one guarded path (social v2a contract §5; review MEDIUM, "readable directly"):
--   supabase test db
--
-- `books.description` is not selectable by the API roles (select is granted on every other column), so
-- `GET /books?select=description` is refused. `book_description` / `book_descriptions` answer it only when
-- the Book was read at its source (checked, not failed), is the caller's own Manual book, or is in her own
-- Library. `search_books` hands the description masked by the same rule.

begin;
select plan(38);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-DESC-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-DESC-1', 'name', p_name)), now(), now(), now());
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
grant all on ids to authenticated, anon, service_role;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

insert into ids values
  ('ada', tests.member('ada@desc.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@desc.pgtap.test', 'Ben'));

select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('pending', (public.add_to_library(tests.snap('Pending Blurb') || '{"isbn13":"9780141439518"}', 'want_to_read', null)).id),
  ('failed',  (public.add_to_library(tests.snap('Failed Blurb'), 'want_to_read', null)).id),
  ('checked', (public.add_to_library(tests.snap('Checked Blurb'), 'want_to_read', null)).id),
  ('manual',  (select book_id from public.add_manual_book('Manual Blurb', array['Ada'], null, null)));
reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('pending', 'failed', 'checked');
update public.books set description = 'Blurb of Manual Blurb' where id = (select id from ids where name = 'manual');
select public.catalogue_check_miss((select id from ids where name = 'b_failed'));
select public.catalogue_check_save((select id from ids where name = 'b_checked'), '{"title":"Checked Blurb","description":"Source blurb of Checked Blurb"}');
insert into ids select 'b_manual', id from ids where name = 'manual';

-- ------------------------------------------------------ the column grants

select ok(not has_column_privilege('authenticated', 'public.books', 'description', 'select'),
  'the API roles cannot select books.description');
select ok(not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.books'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'description'
       and not has_column_privilege('authenticated', 'public.books', a.attname, 'select')),
  'every other column of books is selectable: a column added later is granted in the same migration');
select ok(not has_table_privilege('anon', 'public.books', 'select') and not has_column_privilege('anon', 'public.books', 'description', 'select'),
  'anon reads no books at all');

select tests.act_as((select id from ids where name = 'ada'));
select throws_ok($$ select description from public.books $$, '42501', null, 'GET /books?select=description is refused, even for her own Book');
select throws_ok($$ select * from public.books $$, '42501', null, 'so is select * (the whole row includes it)');
select throws_ok($$ select b from public.books b $$, '42501', null, 'and the whole row');
select throws_ok($$ select count(*) from public.books where description is not null $$, '42501', null, 'and a filter on it (no oracle)');
select lives_ok($$ select id, title, authors, cover_url, checked_at, check_failed from public.books $$, 'the other columns are read as before');
select is((select count(*)::int from public.library_entries e join public.books b on b.id = e.book_id where b.title = 'Pending Blurb'), 1,
  'her entries join their Books');

-- ------------------------------------------------------ the guarded path: Ada

select is(public.book_description((select id from ids where name = 'b_pending')), 'Blurb of Pending Blurb',
  'a member reads the description of an unchecked Book she has in her Library');
select is(public.book_description((select id from ids where name = 'b_failed')), 'Blurb of Failed Blurb',
  'and of a failed one');
select is(public.book_description((select id from ids where name = 'b_checked')), 'Source blurb of Checked Blurb', 'a checked one is the source''s');
select is(public.book_description((select id from ids where name = 'b_manual')), 'Blurb of Manual Blurb', 'her own Manual book''s');
select is(public.book_description(gen_random_uuid()), null, 'a Book that is not there has none');

-- ------------------------------------------------------------------- Ben

select tests.act_as((select id from ids where name = 'ben'));
select is(public.book_description((select id from ids where name = 'b_pending')), null,
  'another member does not read an unchecked Book''s description (it is what the first member sent)');
select is(public.book_description((select id from ids where name = 'b_failed')), null, 'nor a failed one');
select is(public.book_description((select id from ids where name = 'b_checked')), 'Source blurb of Checked Blurb', 'but a checked one');
select is(public.book_description((select id from ids where name = 'b_manual')), null, 'nor another member''s Manual book');
select is(public.book_descriptions(array[(select id from ids where name = 'b_pending'), (select id from ids where name = 'b_failed'),
                                         (select id from ids where name = 'b_checked'), (select id from ids where name = 'b_manual'), gen_random_uuid()]),
  jsonb_build_object((select id from ids where name = 'b_checked'), 'Source blurb of Checked Blurb'),
  'the batch answers only what he may read, as one object');
select is(public.book_descriptions(null), '{}'::jsonb, 'an empty batch is empty');

-- Search: the description masked by the same rule.
select is((select description from public.search_books('Pending Blurb')), null, 'the search hands him an unchecked Book without its description');
select is((select count(*)::int from public.search_books('Pending Blurb')), 1, 'the Book itself is found');
select is((select description from public.search_books('Checked Blurb')), 'Source blurb of Checked Blurb', 'a checked Book''s description is there');
select is((select count(*)::int from public.search_books('Failed Blurb')), 0, 'a failed Book is not handed to him at all');
select is((select description from public.search_books('9780141439518')), null, 'nor by ISBN');

select tests.act_as((select id from ids where name = 'ada'));
select is((select description from public.search_books('Pending Blurb')), 'Blurb of Pending Blurb', 'her own Book, with its description');
select is((select description from public.search_books('Failed Blurb')), 'Blurb of Failed Blurb', 'and her failed one');
select is((select description from public.search_books('Manual Blurb')), 'Blurb of Manual Blurb', 'and her Manual book');

-- Ben has the same Book in his own Library: he reads the row as stored (it is his).
select tests.act_as((select id from ids where name = 'ben'));
select is((public.add_to_library(tests.snap('Pending Blurb') || '{"isbn13":"9780141439518"}', 'want_to_read', null)).id is not null, true,
  'Ben adds the same Book');
select is(public.book_description((select id from ids where name = 'b_pending')), 'Blurb of Pending Blurb',
  'and now reads its description: it is in his own Library');
select is((select description from public.search_books('Pending Blurb')), 'Blurb of Pending Blurb', 'the search too');

-- ------------------------------------------------------------- who may call

select tests.act_anon();
select throws_ok($$ select public.book_description(gen_random_uuid()) $$, '42501', null, 'a visitor cannot call book_description');
select throws_ok($$ select public.book_descriptions('{}') $$, '42501', null, 'nor book_descriptions');
select throws_ok($$ select description from public.books $$, '42501', null, 'and reads no books');

reset role;
select is((select count(*)::int from public.books where id = (select id from ids where name = 'b_pending') and description = 'Blurb of Pending Blurb'), 1,
  'the description is stored as it was (the guard is on reading)');
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select is(public.book_description((select id from ids where name = 'b_failed')), 'Blurb of Failed Blurb', 'the service role reads any blurb (it has the table anyway)');
select is(public.book_description((select id from ids where name = 'b_manual')), 'Blurb of Manual Blurb', 'and a Manual book''s');
reset role;
select is(has_function_privilege('authenticated', 'private.description_readable(public.books)', 'execute'), false, 'the rule itself is private');

select * from finish();
rollback;
