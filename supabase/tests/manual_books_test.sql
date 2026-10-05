-- Manual books, at the database boundary:
--   supabase test db
--
-- A Manual book is private to the member who typed it in: nobody else reads it,
-- finds it by searching the books table, puts it into her own Library or changes
-- it, and it never becomes part of the Catalogue. Members make one only through
-- add_manual_book, which checks what the form checks (and what a hostile client
-- would skip). Every assertion acts as a signed-in member through
-- `request.jwt.claims`, and asks about the rows this test made, never about how
-- many rows a table holds.

begin;
select plan(29);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-MANUAL', 'manual books test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-MANUAL"}'::jsonb, now(), now(), now());
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

select tests.member('ida@manual.test') as ida_id \gset
select tests.member('max@manual.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ---------------------------------------------------------- adding one

select tests.act_as(:'max_id');

select lives_ok(
  $$ select public.add_manual_book(' Zettelkasten Notes ', array['Max Mustermann', ' '], '978-3-16-148410-0', 312) $$,
  'a member types in a book by hand, in one call');

select results_eq(
  $$ select b.title, b.authors, b.isbn13, b.isbn10, b.page_count, b.source, b.owner_id = auth.uid(),
            e.status, e.member_id = auth.uid()
       from public.library_entries e join public.books b on b.id = e.book_id
      where b.title = 'Zettelkasten Notes' $$,
  $$ values ('Zettelkasten Notes', '{"Max Mustermann"}'::text[], '9783161484100', null::text, 312,
             'manual'::public.book_source, true, 'want_to_read'::public.entry_status, true) $$,
  'it is a trimmed Manual book owned by him, on his Want to read');

select lives_ok(
  $$ select public.add_manual_book('Die Blechtrommel', array['Günter Grass'], '0-306-40615-2') $$,
  'only a title and an author are required; an ISBN-10 is accepted');

select results_eq(
  $$ select isbn10, isbn13, page_count from public.books where title = 'Die Blechtrommel' $$,
  $$ values ('0306406152'::text, '9780306406157'::text, null::integer) $$,
  'an ISBN-10 is kept and also stored as its ISBN-13');

select lives_ok(
  $$ select public.add_manual_book('Bare minimum', array['Nobody']) $$,
  'no ISBN and no page count is fine');

select lives_ok(
  $$ select public.add_manual_book('Bare minimum', array['Nobody']) $$,
  'a Manual book may repeat: it is his own copy, not the Catalogue''s');

-- -------------------------------------------------------- what it refuses

select throws_ok(
  $$ select public.add_manual_book('  ', array['Nobody']) $$,
  '22023', 'book_invalid', 'a title is required');
select throws_ok(
  $$ select public.add_manual_book('No author', array[' ']) $$,
  '22023', 'book_invalid', 'an author is required');
select throws_ok(
  $$ select public.add_manual_book('No author', null) $$,
  '22023', 'book_invalid', 'a missing author list is refused too');
select throws_ok(
  $$ select public.add_manual_book('Zero pages', array['Nobody'], null, 0) $$,
  '22023', 'book_invalid', 'a page count has to be positive');
select throws_ok(
  $$ select public.add_manual_book('Bad isbn', array['Nobody'], '9783161484101') $$,
  '22023', 'isbn_invalid', 'an ISBN-13 whose check digit is wrong is refused');
select throws_ok(
  $$ select public.add_manual_book('Bad isbn', array['Nobody'], '12345') $$,
  '22023', 'isbn_invalid', 'so is something that is not an ISBN');
select throws_ok(
  $$ select public.add_manual_book('Bad isbn', array['Nobody'], '0306406153') $$,
  '22023', 'isbn_invalid', 'and an ISBN-10 whose check digit is wrong');
select throws_ok(
  $$ select public.add_manual_book('Reading', array['Nobody'], null, null, 'reading') $$,
  '22023', 'date_invalid', 'adding straight to Currently reading needs its start date (add_with_status_test.sql has the rest)');

select is(
  (select count(*)::integer from public.books where title in ('Bad isbn', 'Zero pages', 'No author')),
  0, 'and a refused call leaves nothing behind');

select throws_ok(
  $$ select public.add_to_library('{"title":"Sneaky","authors":["x"],"source":"manual"}') $$,
  '22023', 'book_invalid', 'the Catalogue path does not take Manual books');

-- ------------------------------------------------------- private to him

select ok(
  exists (select 1 from public.books where title = 'Zettelkasten Notes' and owner_id = :'max_id'),
  'its owner sees his Manual book');

select tests.act_as(:'ida_id');

select is_empty(
  $$ select 1 from public.books where title = 'Zettelkasten Notes' $$,
  'another member does not see it');

select is_empty(
  $$ select 1 from public.books where isbn13 = '9783161484100' or title ilike 'Zettelkasten%' $$,
  'nor find it by searching the books table by title or ISBN');

select is_empty(
  $$ select 1 from public.books where source = 'manual' and title in ('Die Blechtrommel', 'Bare minimum') $$,
  'nor any other Manual book of his');

select is_empty(
  $$ select 1 from public.library_entries where member_id = auth.uid() $$,
  'and her Library is not touched');

select throws_ok(
  $$ update public.books set title = 'Defaced' where title = 'Zettelkasten Notes' $$,
  '42501', null, 'another member cannot edit it');
select throws_ok(
  $$ delete from public.books where title = 'Zettelkasten Notes' $$,
  '42501', null, 'nor delete it');
select throws_ok(
  $$ insert into public.library_entries (member_id, book_id)
     select auth.uid(), id from public.books where title = 'Zettelkasten Notes' $$,
  '42501', null, 'nor put it into her Library behind add_manual_book''s back');

-- Her own Manual book with the same title and ISBN is hers and does not clash
-- with his, nor does it appear for him.
select lives_ok(
  $$ select public.add_manual_book('Zettelkasten Notes', array['Ida'], '9783161484100') $$,
  'two members can type in the same book without meeting');

select tests.act_as(:'max_id');

select is(
  (select count(*)::integer from public.books where title = 'Zettelkasten Notes'),
  1, 'and he still sees only his own');

select throws_ok(
  $$ update public.books set title = 'Edited by hand' where title = 'Zettelkasten Notes' $$,
  '42501', null, 'members do not write books directly, not even their own');

-- ---------------------------------------------------- not in the Catalogue

select is_empty(
  $$ select 1 from public.books where owner_id is null and title = 'Zettelkasten Notes' $$,
  'a Manual book never became a Catalogue Book');

-- ------------------------------------------------------ a visitor, no JWT

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select throws_ok(
  $$ select public.add_manual_book('Visitor', array['Nobody']) $$,
  '42501', null, 'a visitor cannot add a Manual book');

reset role;
select * from finish();
rollback;
