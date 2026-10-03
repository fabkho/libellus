-- Collections, at the database boundary:
--   supabase test db
--
-- A member's Collections and what is on them are hers alone: nobody else reads
-- them, changes them or puts a Book on them. Members change them only through
-- the collection functions, which keep the rules: a name per member, deleting a
-- Collection never deletes a Library entry, and adding a Book that is not in
-- the Library puts it there first, on Want to read, in the same call. Every
-- assertion acts as a signed-in member through `request.jwt.claims`, and asks
-- about the rows this test made, never about how many rows a table holds.

begin;
select plan(47);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-COLLECTIONS', 'collections test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-COLLECTIONS"}'::jsonb, now(), now(), now());
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

select tests.member('ida@collections.test') as ida_id \gset
select tests.member('max@collections.test') as max_id \gset

-- Source ids no real Apple book will have.
\set piranesi '{"title":"Piranesi","authors":["Susanna Clarke"],"source":"apple","apple_id":"990000001401"}'
\set klara '{"title":"Klara and the Sun","authors":["Kazuo Ishiguro"],"source":"apple","apple_id":"990000001402","isbn13":"9780571364886"}'
\set dune '{"title":"Dune","authors":["Frank Herbert"],"source":"apple","apple_id":"990000001403"}'

-- A Catalogue Book nobody has in their Library yet, and a Manual book of Max's.
insert into public.books (title, authors, source, apple_id)
values ('The Left Hand of Darkness', '{Ursula K. Le Guin}', 'apple', '990000001404')
returning id as lefthand_id \gset
insert into public.books (title, authors, source, owner_id)
values ('Max''s notebook', '{Max}', 'manual', :'max_id')
returning id as manual_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------ create, rename

select tests.act_as(:'ida_id');

select is(
  (select name from public.create_collection('  Sci-fi  ')),
  'Sci-fi', 'a member creates a Collection; its name is trimmed');
select id as scifi_id from public.collections where name = 'Sci-fi' \gset
select lives_ok($$ select public.create_collection('Gifts   for  Mum') $$, 'and another');
select id as gifts_id from public.collections where member_id = :'ida_id' and name = 'Gifts for Mum' \gset
select ok(
  (select position from public.collections where id = :'gifts_id')
    > (select position from public.collections where id = :'scifi_id'),
  'a new Collection goes to the end of her list, inner spaces collapsed');

select throws_ok($$ select public.create_collection('sci-FI') $$,
  '23505', 'name_taken', 'a second Collection with the same name, in any case, is refused');
select throws_ok($$ select public.create_collection('   ') $$,
  '22023', 'name_invalid', 'a blank name is refused');
select throws_ok(format($$ select public.create_collection(%L) $$, repeat('x', 81)),
  '22023', 'name_invalid', 'so is one longer than 80 characters');

select is(
  (select name from public.rename_collection(:'scifi_id', 'Science fiction')),
  'Science fiction', 'she renames a Collection');
select throws_ok(format($$ select public.rename_collection(%L, 'GIFTS FOR MUM') $$, :'scifi_id'),
  '23505', 'name_taken', 'not to the name of another of hers');
select lives_ok(format($$ select public.rename_collection(%L, 'SCIENCE fiction') $$, :'scifi_id'),
  'but changing the case of its own name is fine');

-- ------------------------------------------- add_to_collection, from a snapshot

select is(
  (select status from public.add_to_collection(:'scifi_id', :'piranesi'::jsonb)),
  'want_to_read'::public.entry_status,
  'adding a Book from search that is not in her Library puts it on Want to read');
select is(
  (select count(*)::int from public.library_entries e join public.books b on b.id = e.book_id
    where e.member_id = :'ida_id' and b.apple_id = '990000001401'),
  1, 'in the same call: the Library entry exists');
select is(
  (select count(*)::int from public.books where apple_id = '990000001401' and owner_id is null),
  1, 'and the Book entered the Catalogue');
select ok(
  exists (select 1 from public.collection_entries ce join public.library_entries e on e.id = ce.entry_id
           join public.books b on b.id = e.book_id
          where ce.collection_id = :'scifi_id' and b.apple_id = '990000001401'),
  'and it is on the Collection');

select throws_ok(format($$ select public.add_to_collection(%L, %L::jsonb) $$, :'scifi_id', :'piranesi'),
  '23505', 'already_in_collection', 'the same Book twice on one Collection is refused');

-- A Book already in her Library is not added again.
select id as klara_id from public.add_to_library(:'klara'::jsonb) \gset
select lives_ok(format($$ select public.add_to_collection(%L, %L::jsonb) $$, :'scifi_id', :'klara'),
  'a Book already in her Library goes on a Collection too');
select is(
  (select count(*)::int from public.library_entries where member_id = :'ida_id' and id = :'klara_id'),
  1, 'without a second entry');
select is(
  (select entry_id from public.collection_entries where collection_id = :'scifi_id' order by position desc limit 1),
  :'klara_id'::uuid, 'at the end of the Collection');

-- By its ISBN, under another source id: the same Catalogue Book.
select is(
  (select id from public.add_to_collection(:'gifts_id',
    '{"title":"Klara","source":"apple","apple_id":"990000001499","isbn13":"978-0-571-36488-6"}'::jsonb)),
  :'klara_id'::uuid, 'a snapshot is matched by its ISBN first, as add_to_library does');

select throws_ok(format($$ select public.add_to_collection(%L, '{"source":"apple","apple_id":"990000001405"}'::jsonb) $$, :'scifi_id'),
  '22023', 'book_invalid', 'a snapshot add_to_library would refuse is refused');
select is_empty($$ select 1 from public.books where apple_id = '990000001405' $$,
  'and leaves nothing behind');

-- ------------------------------------------------- add_to_collection, by id

select is(
  (select status from public.add_to_collection(:'gifts_id', json_build_object('id', :'lefthand_id')::jsonb)),
  'want_to_read'::public.entry_status,
  'a Catalogue Book by its id that is not in her Library goes onto Want to read');
select ok(
  exists (select 1 from public.library_entries where member_id = :'ida_id' and book_id = :'lefthand_id'),
  'its entry was made in the same call');

select throws_ok(format($$ select public.add_to_collection(%L, %L::jsonb) $$, :'gifts_id', json_build_object('id', :'manual_id')),
  '22023', 'book_invalid', 'another member''s Manual book cannot be put on a Collection');
select ok(
  not exists (select 1 from public.library_entries where member_id = :'ida_id' and book_id = :'manual_id'),
  'nor does it enter her Library that way');
select throws_ok(format($$ select public.add_to_collection(%L, '{"id":"nope"}'::jsonb) $$, :'gifts_id'),
  '22023', 'book_invalid', 'an id that is not one is refused');

-- ------------------------------------------------------------------- reorder

select id as piranesi_entry from public.library_entries e
  where e.member_id = :'ida_id' and e.book_id = (select id from public.books where apple_id = '990000001401') \gset

select lives_ok(format($$ select public.reorder_collection(%L, array[%L, %L]::uuid[]) $$,
  :'scifi_id', :'klara_id', :'piranesi_entry'), 'she puts the Collection in her own order');
select results_eq(
  format($$ select entry_id from public.collection_entries where collection_id = %L order by position $$, :'scifi_id'),
  format($$ values (%L::uuid), (%L::uuid) $$, :'klara_id', :'piranesi_entry'),
  'and it keeps it');
select throws_ok(format($$ select public.reorder_collection(%L, array[%L]::uuid[]) $$, :'scifi_id', :'klara_id'),
  '22023', 'order_mismatch', 'an order that leaves an entry out is refused');
select throws_ok(format($$ select public.reorder_collection(%L, array[%L, %L, %L]::uuid[]) $$,
  :'scifi_id', :'klara_id', :'piranesi_entry', :'klara_id'),
  '22023', 'order_mismatch', 'so is one that names an entry twice');
select throws_ok(format($$ select public.reorder_collection(%L, array[%L, %L]::uuid[]) $$,
  :'scifi_id', :'klara_id', gen_random_uuid()),
  '22023', 'order_mismatch', 'or one with an entry that is not on it');

-- ------------------------------------------------------------------- remove

select lives_ok(format($$ select public.remove_from_collection(%L, %L) $$, :'scifi_id', :'klara_id'),
  'she takes a Book off a Collection');
select ok(
  exists (select 1 from public.library_entries where id = :'klara_id'),
  'it stays in her Library');
select ok(
  exists (select 1 from public.collection_entries where collection_id = :'gifts_id' and entry_id = :'klara_id'),
  'and on her other Collections');
select throws_ok(format($$ select public.remove_from_collection(%L, %L) $$, :'scifi_id', :'klara_id'),
  'P0002', 'not_in_collection', 'taking off what is not on it says so');

-- ---------------------------------------------------------------- other member

select tests.act_as(:'max_id');

select is_empty(format($$ select 1 from public.collections where id in (%L, %L) $$, :'scifi_id', :'gifts_id'),
  'another member cannot see her Collections');
select is_empty(format($$ select 1 from public.collection_entries where collection_id = %L $$, :'gifts_id'),
  'nor what is on them');
select throws_ok(format($$ select public.rename_collection(%L, 'Mine now') $$, :'scifi_id'),
  'P0002', 'collection_missing', 'nor rename them');
select throws_ok(format($$ select public.add_to_collection(%L, %L::jsonb) $$, :'scifi_id', :'dune'),
  'P0002', 'collection_missing', 'nor put a Book on them');
select is_empty($$ select 1 from public.books where apple_id = '990000001403' $$,
  'and that failed add left nothing in the Catalogue');
select throws_ok(format($$ select public.delete_collection(%L) $$, :'gifts_id'),
  'P0002', 'collection_missing', 'nor delete them');
select throws_ok(format($$ select public.remove_from_collection(%L, %L) $$, :'gifts_id', :'klara_id'),
  'P0002', 'collection_missing', 'nor take a Book off them');

-- Max may name his own shelf like hers.
select lives_ok($$ select public.create_collection('Science fiction') $$,
  'names are per member: he can have a Collection by the same name');

-- Nobody writes the tables directly.
select throws_ok(format($$ insert into public.collections (member_id, name, position) values (%L, 'Sneaky', 1) $$, :'max_id'),
  '42501', null, 'members cannot write collections directly');
select throws_ok(format($$ delete from public.collection_entries where collection_id = %L $$, :'gifts_id'),
  '42501', null, 'nor collection_entries');

-- ------------------------------------------------------------------- delete

select tests.act_as(:'ida_id');

select lives_ok(format($$ select public.delete_collection(%L) $$, :'gifts_id'), 'she deletes a Collection');
select ok(
  (select count(*) from public.library_entries where id = :'klara_id' or book_id = :'lefthand_id') = 2,
  'the Books on it stay in her Library');

-- Deleting an entry takes its memberships with it (as the owner: #7's
-- removeFromLibrary is the member's way).
reset role;
delete from public.library_entries where id = :'piranesi_entry';
select is_empty(format($$ select 1 from public.collection_entries where entry_id = %L $$, :'piranesi_entry'),
  'an entry that leaves the Library leaves its Collections too');

select * from finish();
rollback;
