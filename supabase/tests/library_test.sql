-- The Catalogue, the Library and add_to_library, at the database boundary:
--   supabase test db
--
-- What a broken (or hostile) client must not get past: a member reads the
-- Catalogue but cannot write it, sees only her own Library, and puts a Book in
-- it only through add_to_library — which finds the Catalogue Book instead of
-- making a second one, keeps the first snapshot, and refuses the same Book
-- twice. Every assertion acts as a signed-in member through
-- `request.jwt.claims`, and asks about the rows this test made, never about how
-- many rows a table holds.

begin;
select plan(32);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-LIBRARY', 'library test', 5);

-- A member the way the invite gate lets one in: invited, address proved.
create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-LIBRARY"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

-- Acting as a member: the claims PostgREST would set from her JWT, and her role.
create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

select tests.member('ida@library.test') as ida_id \gset
select tests.member('max@library.test') as max_id \gset

-- Source ids no real Apple book will have, so the developer's own Catalogue
-- rows never collide with these.
\set piranesi '{"title":" Piranesi ","authors":["Susanna Clarke"," "],"source":"apple","apple_id":"990000000001","published_year":2020,"cover_url":"https://example.test/600x900bb.jpg","cover_thumbhash":"1QcSHQRnh493V4dIh4eXh1h4kJUI","cover_dominant":"#3A5F8C","cover_secondary":"#D9C9A0"}'

-- A Manual book of Max's, as #13 will make them: private to him.
insert into public.books (title, authors, source, owner_id)
values ('Max''s notebook', '{Max}', 'manual', :'max_id')
returning id as manual_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------ add_to_library

select tests.act_as(:'ida_id');

select lives_ok(
  format($$ select public.add_to_library(%L::jsonb) $$, :'piranesi'),
  'a member adds a Book from Apple Books in one call');

select is(
  (select status from public.library_entries e join public.books b on b.id = e.book_id
    where b.apple_id = '990000000001' and e.member_id = :'ida_id'),
  'want_to_read'::public.entry_status,
  'and it is on her Want to read');

select results_eq(
  $$ select title, authors, source, cover_dominant from public.books where apple_id = '990000000001' $$,
  $$ values ('Piranesi', '{"Susanna Clarke"}'::text[], 'apple'::public.book_source, '#3a5f8c') $$,
  'the Book entered the Catalogue trimmed, with its authors in order and its cover colours');

select throws_ok(
  format($$ select public.add_to_library(%L::jsonb) $$, :'piranesi'),
  '23505', 'already_in_library', 'adding the same Book twice fails clearly');

select throws_ok(
  $$ select public.add_to_library('{"title":"Piranesi","source":"apple","apple_id":"990000000001"}') $$,
  '23505', 'already_in_library', 'also when the second snapshot differs');

-- An ISBN-13 match finds the Catalogue Book even under another source id.
select lives_ok(
  $$ select public.add_to_library('{"title":"Klara and the Sun","authors":["Kazuo Ishiguro"],"source":"apple","apple_id":"990000000002","isbn13":"978-0-571-36487-9"}') $$,
  'a Book with an ISBN goes in');
select is(
  (select isbn13 from public.books where apple_id = '990000000002'),
  '9780571364879', 'with its ISBN-13 normalised to digits');

select throws_ok(
  $$ select public.add_to_library('{"authors":["Nobody"],"source":"apple","apple_id":"990000000003"}') $$,
  '22023', 'book_invalid', 'a Book without a title is refused');
select throws_ok(
  $$ select public.add_to_library('{"title":"Untraceable","source":"apple"}') $$,
  '22023', 'book_invalid', 'a Book with no ISBN and no source id is refused');
select throws_ok(
  $$ select public.add_to_library('{"title":"Mine","source":"manual","isbn13":"9780000000002"}') $$,
  '22023', 'book_invalid', 'Manual books do not enter through the Catalogue path');
select throws_ok(
  $$ select public.add_to_library('{"title":"Imported","source":"import","apple_id":"990000000007"}') $$,
  '22023', 'book_invalid', 'nor do imports: only what search finds');
select throws_ok(
  $$ select public.add_to_library('{"title":"Later","source":"apple","apple_id":"990000000004"}', 'reading') $$,
  '22023', 'date_invalid', 'adding straight to Currently reading needs its start date (add_with_status_test.sql has the rest)');
select is_empty(
  $$ select 1 from public.books where apple_id in ('990000000003', '990000000004', '990000000007') $$,
  'and a refused add leaves nothing behind in the Catalogue');

-- --------------------------------------------- the same Book, another member

select tests.act_as(:'max_id');

select results_eq(
  $$ select title from public.books where apple_id = '990000000001' $$,
  $$ values ('Piranesi') $$,
  'the Catalogue is readable by every member');

select lives_ok(
  $$ select public.add_to_library('{"title":"Piranesi (rewritten)","source":"apple","apple_id":"990000000001","description":"Another blurb."}') $$,
  'another member adds the same Book');
select results_eq(
  $$ select b.title, b.description from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = auth.uid() and b.apple_id = '990000000001' $$,
  $$ values ('Piranesi', null::text) $$,
  'it is the same Catalogue Book, and the first snapshot is kept');

select lives_ok(
  $$ select public.add_to_library('{"title":"Klara und die Sonne","source":"apple","apple_id":"990000000005","isbn13":"9780571364879"}') $$,
  'a member adds a Book whose ISBN-13 is already in the Catalogue under another id');
select results_eq(
  $$ select b.title, b.apple_id from public.library_entries e join public.books b on b.id = e.book_id
      where e.member_id = auth.uid() and b.isbn13 = '9780571364879' $$,
  $$ values ('Klara and the Sun', '990000000002') $$,
  'and gets the Catalogue Book with that ISBN, not a second one');
select is_empty(
  $$ select 1 from public.books where apple_id = '990000000005' $$,
  'no duplicate edition was made');

-- -------------------------------------------------------- RLS: the Library

select isnt_empty(
  $$ select 1 from public.library_entries where member_id = auth.uid() $$,
  'a member sees her own Library');
select is_empty(
  format($$ select 1 from public.library_entries where member_id = %L $$, :'ida_id'),
  'but nothing of another member''s');

select isnt_empty(
  format($$ select 1 from public.books where id = %L $$, :'manual_id'),
  'a member sees his own Manual book');

select tests.act_as(:'ida_id');

select is_empty(
  format($$ select 1 from public.books where id = %L $$, :'manual_id'),
  'and nobody else does');

select throws_ok(
  $$ insert into public.library_entries (member_id, book_id)
     select auth.uid(), id from public.books where apple_id = '990000000002' $$,
  '42501', null, 'a member cannot write a Library entry directly');
select throws_ok(
  $$ update public.library_entries set status = 'finished' where member_id = auth.uid() $$,
  '42501', null, 'nor set a status by hand');
select throws_ok(
  $$ delete from public.library_entries where member_id = auth.uid() $$,
  '42501', null, 'nor delete entries behind the Library actions'' back');

-- ------------------------------------------------------ RLS: the Catalogue

select throws_ok(
  $$ insert into public.books (title, source, apple_id) values ('Sneaky', 'apple', '990000000006') $$,
  '42501', null, 'a member cannot put a Book into the Catalogue directly');
select throws_ok(
  $$ update public.books set title = 'Defaced' where apple_id = '990000000001' $$,
  '42501', null, 'nor edit a Catalogue Book');
select throws_ok(
  $$ delete from public.books where apple_id = '990000000001' $$,
  '42501', null, 'nor delete one');

-- ------------------------------------------------------ a visitor, no JWT

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$ select 1 from public.books $$,
  '42501', 'permission denied for table books', 'a visitor cannot read the Catalogue');
select throws_ok(
  $$ select 1 from public.library_entries $$,
  '42501', 'permission denied for table library_entries', 'nor any Library');
select throws_ok(
  format($$ select public.add_to_library(%L::jsonb) $$, :'piranesi'),
  '42501', null, 'nor add anything');

reset role;
select * from finish();
rollback;
