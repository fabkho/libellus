-- A mismatch frees the keys it was squatting on, and a client never stores a Catalogue description (social
-- v2a contract §5, C3):
--   supabase test db
--
-- A row whose keys disagree with its source (a real ISBN paired with another Book's Apple id) is a
-- mismatch, not a mere miss: the check marks it failed, clears its description and its source keys, so the
-- unique indexes free the ISBN for an honest add; the members who hold the row keep it, others see it
-- "unverified". A miss keeps the keys. A Catalogue row never starts with a description, whoever inserts it;
-- a Manual book keeps its own.

begin;
select plan(22);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-MISMATCH-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-MISMATCH-1', 'name', p_name)), now(), now(), now());
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
grant all on ids to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

insert into ids values
  ('ada', tests.member('ada@mismatch.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@mismatch.pgtap.test', 'Ben'));

select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(false);
insert into ids values
  ('planted', (public.add_to_library(tests.snap('Planted Pair') || '{"isbn13":"9780141439518","openlibrary_edition_key":"OL777M","openlibrary_work_key":"OL777W"}', 'want_to_read', null)).id),
  ('missed',  (public.add_to_library(tests.snap('Missed Pair') || '{"isbn13":"9780141439600"}', 'want_to_read', null)).id),
  ('titled',  (public.add_to_library(tests.snap('Titled Pair') || '{"isbn13":"9780141439709"}', 'want_to_read', null)).id),
  ('manual',  (select book_id from public.add_manual_book('Manual Mine', array['Ada'], null, null)));
reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('planted', 'missed', 'titled');
insert into ids select 'b_manual', id from ids where name = 'manual';

-- ------------------------------------------- a client's description is not stored

select is((select count(*)::int from public.books where id in (select id from ids where name like 'b\_%') and description is not null), 0,
  'a description a client sends for a Catalogue Book is not stored');
insert into public.books (title, authors, source, apple_id, description) values ('Direct Insert', '{A}', 'apple', '9877700000001', 'a blurb');
select is((select description from public.books where apple_id = '9877700000001'), null, 'nor one inserted straight into the Catalogue');
update public.books set description = 'Manual blurb' where id = (select id from ids where name = 'b_manual');
select is((select description from public.books where id = (select id from ids where name = 'b_manual')), 'Manual blurb', 'a Manual book keeps its own (only its owner reads it)');
update public.books set description = 'Legacy blurb' where id = (select id from ids where name = 'b_planted');

-- ------------------------------------------------------------------ a mismatch

select is(public.catalogue_check_mismatch((select id from ids where name = 'b_planted')), true, 'a mismatch answers true');
select is((select (check_failed, checked_at is not null, description)::text from public.books where id = (select id from ids where name = 'b_planted')),
  '(t,t,)', 'the Book is failed, checked, without a description');
select is((select (isbn13, isbn10, apple_id, openlibrary_edition_key, openlibrary_work_key)::text from public.books where id = (select id from ids where name = 'b_planted')),
  '(,,,,)', 'and without its source keys');
select is((select (title, authors)::text from public.books where id = (select id from ids where name = 'b_planted')),
  '("Planted Pair","{""An Author""}")', 'it keeps what the member sent for her own Library');
select is((select count(*)::int from private.catalogue_check_state where book_id = (select id from ids where name = 'b_planted')), 0, 'and is out of the queue');
select is(public.catalogue_check_mismatch((select id from ids where name = 'b_planted')), false, 'a Book already checked is not written again');
select is(public.catalogue_check_mismatch((select id from ids where name = 'b_manual')), false, 'a Manual book is never checked');

select tests.act_as((select id from ids where name = 'ada'));
select is((select count(*)::int from public.library_entries where book_id = (select id from ids where name = 'b_planted')), 1, 'the member who holds the row keeps her entry');
select is((select title from public.books where id = (select id from ids where name = 'b_planted')), 'Planted Pair', 'and reads it as she added it');

-- Others: "unverified".
select tests.act_as((select id from ids where name = 'ben'));
select public.follow((select id from ids where name = 'ada'));
select is((select count(*)::int from jsonb_array_elements(public.member_want((select id from ids where name = 'ada'))) w
            where w -> 'book' ->> 'id' = (select id::text from ids where name = 'b_planted') and w -> 'book' -> 'unverified' = 'true'::jsonb
              and w -> 'book' -> 'title' = 'null'::jsonb), 1,
  'to a follower it is "unverified": no title');

-- The ISBN is free: an honest add of it is a new row, not the squatter's.
select is((select id from public.add_to_library(tests.snap('Honest Book') || '{"isbn13":"9780141439518"}', 'want_to_read', null)) is not null, true,
  'Ben adds the real Book by the ISBN the squatter used');
reset role;
select isnt((select book_id from public.library_entries where member_id = (select id from ids where name = 'ben')), (select id from ids where name = 'b_planted'),
  'he gets a row of his own, not the failed one');
select is((select count(*)::int from public.books where isbn13 = '9780141439518'), 1, 'the ISBN is in the Catalogue once, with the honest Book');

-- ---------------------------------------------------------------- a mere miss

select public.catalogue_check_miss((select id from ids where name = 'b_missed'));
select is((select (check_failed, isbn13, description)::text from public.books where id = (select id from ids where name = 'b_missed')),
  '(t,9780141439600,)', 'a miss (the source does not know it) keeps the keys');

-- ------------------------------------------------- the save's title lock is a mismatch too

select is(public.catalogue_check_save((select id from ids where name = 'b_titled'), '{"title":"A Bestseller","description":"theirs"}'), false,
  'a source title that is not the Book''s writes nothing');
select is((select (check_failed, isbn13, apple_id, description)::text from public.books where id = (select id from ids where name = 'b_titled')),
  '(t,,,)', 'and frees its keys');

-- ----------------------------------------------------- the key requirement

select throws_ok($$ insert into public.books (title, authors, source) values ('No Key', '{A}', 'apple') $$, '23514', null,
  'a Catalogue row still needs a source key');
select lives_ok($$ insert into public.books (title, authors, source, check_failed, checked_at) values ('Failed No Key', '{A}', 'apple', true, now()) $$,
  'unless it is a failed one');

-- Only the service role calls it.
select tests.act_as((select id from ids where name = 'ada'));
select throws_ok($$ select public.catalogue_check_mismatch(gen_random_uuid()) $$, '42501', null, 'a member cannot call catalogue_check_mismatch');
reset role;
select * from finish();
rollback;
