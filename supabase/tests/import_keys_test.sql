-- The import keys the owner's Fable import (#17) writes, at the database
-- boundary:
--   supabase test db
--
-- The import writes as the service role and finds its rows again by
-- `import_key` (`fable:<tracker id>`), so a rerun never doubles anything: one
-- key per member's Library and one per entry's sessions, null (everything made
-- in the app) never clashing, and members can neither write the keys nor see
-- another member's. A Book the import wrote as `import` is still everybody's
-- Catalogue: another member adds the same row (#17 follow-up). Assertions ask
-- about the rows this test made.

begin;
select plan(18);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-IMPORT', 'import keys test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-IMPORT"}'::jsonb, now(), now(), now());
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

-- The way the import writes: the service role, past RLS.
create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end;
$$;

grant usage on schema tests to authenticated, service_role;
grant execute on all functions in schema tests to authenticated, service_role;

select tests.member('ida@import.test') as ida_id \gset
select tests.member('max@import.test') as max_id \gset

-- --------------------------------------------------------- as the importer

select tests.act_as_service();

insert into public.books (title, authors, isbn13, source)
values ('Piranesi', '{Susanna Clarke}', '9790000000011', 'import') returning id as piranesi \gset
insert into public.books (title, authors, isbn13, source)
values ('Kindred', '{Octavia E. Butler}', '9790000000028', 'import') returning id as kindred \gset

select lives_ok(
  format($$ insert into public.library_entries (member_id, book_id, import_key) values (%L, %L, 'fable:aaa') $$, :'ida_id', :'piranesi'),
  'the importer writes an entry with its import key');
select id as ida_piranesi from public.library_entries where member_id = :'ida_id' and import_key = 'fable:aaa' \gset

select throws_ok(
  format($$ insert into public.library_entries (member_id, book_id, import_key) values (%L, %L, 'fable:aaa') $$, :'ida_id', :'kindred'),
  '23505', null, 'one import key once per member''s Library: a rerun cannot add the record again');
select lives_ok(
  format($$ insert into public.library_entries (member_id, book_id, import_key) values (%L, %L, 'fable:aaa') $$, :'max_id', :'piranesi'),
  'another member''s Library has its own keys');
select lives_ok(
  format($$ insert into public.library_entries (member_id, book_id) values (%L, %L) $$, :'ida_id', :'kindred'),
  'an entry made in the app has no key');
select throws_ok(
  format($$ insert into public.library_entries (member_id, book_id, import_key) values (%L, %L, '  ') $$, :'max_id', :'kindred'),
  '23514', null, 'a key is never blank');

select lives_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, import_key)
            values (%L, '2024-01-02', '2024-01-20', 'finished', 19, 'fable:aaa') $$, :'ida_piranesi'),
  'the importer writes a finished read with its quarter-star Rating and key');
select throws_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, import_key)
            values (%L, '2024-03-02', '2024-03-20', 'finished', 'fable:aaa') $$, :'ida_piranesi'),
  '23505', null, 'one key once per entry''s sessions: the same Fable read is never added twice');
select lives_ok(
  format($$ insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, import_key)
            values (%L, '2025-03-02', '2025-03-20', 'finished', 'fable:bbb') $$, :'ida_piranesi'),
  'another read of the same entry has its own key');
select lives_ok(
  format($$ insert into public.reading_sessions (entry_id, outcome) values (%L, 'finished') $$, :'ida_piranesi'),
  'sessions without a key never clash with each other');
select is(
  (select status from public.library_entries where id = :'ida_piranesi'),
  'finished'::public.entry_status,
  'and the Status still follows from the sessions, however they were written');

-- ------------------------------------------------------------- as a member

select tests.act_as(:'ida_id');

select results_eq(
  $$ select import_key from public.library_entries where import_key is not null $$,
  $$ values ('fable:aaa') $$,
  'a member sees the keys of her own entries only');
select throws_ok(
  format($$ update public.library_entries set import_key = 'fable:zzz' where id = %L $$, :'ida_piranesi'),
  '42501', null, 'and cannot change an entry''s key');
select throws_ok(
  format($$ update public.reading_sessions set import_key = null where entry_id = %L $$, :'ida_piranesi'),
  '42501', null, 'nor a session''s');

-- ------------------------------------- imported Books are everybody's Catalogue

-- Max finds Kindred in search: a Catalogue Book the import wrote with source
-- `import`. Adding it sends that snapshot back to add_to_library.
select tests.act_as(:'max_id');

select is(
  (public.add_to_library('{"title":"Kindred","authors":["Octavia E. Butler"],"source":"import","isbn13":"9790000000028"}')).book_id,
  :'kindred'::uuid,
  'another member adds an imported Book: the same Catalogue Book, not a copy');
select is(
  (select status from public.library_entries where member_id = :'max_id' and book_id = :'kindred'),
  'want_to_read'::public.entry_status,
  'on Want to read, like any Book added from search');
select throws_ok(
  $$ select public.add_to_library('{"title":"Invented","source":"import","isbn13":"9790000000035"}') $$,
  '22023', 'book_invalid', 'but an import snapshot that matches no Catalogue Book is refused: only the import makes them');

-- Ida's Manual book with an ISBN stays hers: an import snapshot never reaches it.
select tests.act_as(:'ida_id');
select (public.add_manual_book('Private Notes', array['Ida Example'], '9790000000049')).book_id as private_book \gset
select tests.act_as(:'max_id');
select throws_ok(
  $$ select public.add_to_library('{"title":"Private Notes","source":"import","isbn13":"9790000000049"}') $$,
  '22023', 'book_invalid', 'and a Manual book is never found that way: it stays private');
select is_empty(
  format($$ select 1 from public.library_entries where book_id = %L $$, :'private_book'),
  'so nobody else holds it');

reset role;
select * from finish();
rollback;
