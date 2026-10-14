-- One Book, one cover (docs/plans/covers-consistency.md; 20261029020000_check_keeps_cover.sql):
--   supabase test db
--
-- The Catalogue's check keeps a Book's cover, with its thumbhash and colours, and fills only a missing one.

begin;
select plan(5);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-CHECK-COVER', 'check cover test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_build_object('invite_code', 'T-CHECK-COVER'), now(), now(), now());
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

create or replace function tests.cover(p_id int) returns text language sql immutable as $$
  select 'https://covers.openlibrary.org/b/id/' || p_id || '-L.jpg'
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Whatever else is in this database is checked already: the checks below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

select tests.act_as(tests.member('ada@check-cover.pgtap.test'));

-- The check keeps the cover a Book entered with, and fills one that is missing.
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Kept Cover', 'authors', jsonb_build_array('An Author'),
  'source', 'openlibrary', 'openlibrary_edition_key', 'OL9900005M', 'cover_url', tests.cover(9010),
  'cover_thumbhash', 'abc', 'cover_dominant', '#112233', 'cover_secondary', '#445566'), 'want_to_read', null)).book_id as kept
  \gset
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Filled Cover', 'authors', jsonb_build_array('An Author'),
  'source', 'openlibrary', 'openlibrary_edition_key', 'OL9900006M'), 'want_to_read', null)).book_id as filled
  \gset
reset role;

select is(public.catalogue_check_save(:'kept', jsonb_build_object('title', 'Pgtap Kept Cover', 'cover_url', tests.cover(9011))), true,
  'the check saves a Book whose source names another cover');
select is(public.catalogue_check_save(:'filled', jsonb_build_object('title', 'Pgtap Filled Cover', 'cover_url', tests.cover(9012))), true,
  'and one that had none');
reset role;
select is((select (cover_url, cover_thumbhash, cover_dominant, cover_secondary)::text from public.books where id = :'kept'),
  '(' || tests.cover(9010) || ',abc,#112233,#445566)',
  'the Book keeps the cover it entered with, and its thumbhash and colours: the row and the page show it still');
select is((select (cover_url, cover_thumbhash)::text from public.books where id = :'filled'), '(' || tests.cover(9012) || ',)',
  'a Book without a cover gets the source''s, with no thumbhash yet');
select isnt((select checked_at from public.books where id = :'kept'), null, 'and the check is done');

select * from finish();
rollback;
