-- Delete your account from inside the app (issue #101):
--   supabase test db
--
-- `delete_my_account()` deletes the calling member completely: the sign-in
-- (auth.users and what Supabase keeps for it), the account, the Library with its
-- reads, ratings and reviews and progress days, the collections, the manual Books
-- and the record of synced writes. Other members are untouched (their entries,
-- even on the same Catalogue Book, stay), the Catalogue Book itself stays, the
-- invite code stays with its use count, a signed-out caller is refused, and there
-- is no argument to delete somebody else with. Assertions ask about the rows this
-- test made, never about how many rows a table holds.

begin;
select plan(23);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-DELACC', 'delete account test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-DELACC"}'::jsonb, now(), now(), now());
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

-- Everything one member owns, counted past RLS (security definer).
create or replace function tests.owned(p_member uuid)
returns table (what text, n bigint) language sql security definer as $$
  select 'users', count(*) from auth.users where id = p_member
  union all select 'identities', count(*) from auth.identities where user_id = p_member
  union all select 'sessions', count(*) from auth.sessions where user_id = p_member
  union all select 'accounts', count(*) from public.accounts where id = p_member
  union all select 'entries', count(*) from public.library_entries where member_id = p_member
  union all select 'reads', count(*) from public.reading_sessions s
              join public.library_entries e on e.id = s.entry_id where e.member_id = p_member
  union all select 'collections', count(*) from public.collections where member_id = p_member
  union all select 'manual_books', count(*) from public.books where owner_id = p_member
  union all select 'synced_writes', count(*) from public.synced_writes where member_id = p_member
$$;

create or replace function tests.total(p_member uuid)
returns bigint language sql security definer as $$
  select coalesce(sum(n), 0) from tests.owned(p_member)
$$;

create or replace function tests.days_of(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.reading_progress_days d
    join public.reading_sessions s on s.id = d.session_id
    join public.library_entries e on e.id = s.entry_id where e.member_id = p_member
$$;

create or replace function tests.in_collections(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.collection_entries ce
    join public.collections c on c.id = ce.collection_id where c.member_id = p_member
$$;

create or replace function tests.books_with(p_apple_id text)
returns bigint language sql security definer as $$
  select count(*) from public.books where apple_id = p_apple_id
$$;

create or replace function tests.entries_on(p_apple_id text)
returns bigint language sql security definer as $$
  select count(*) from public.library_entries e join public.books b on b.id = e.book_id
   where b.apple_id = p_apple_id
$$;

create or replace function tests.invite_uses()
returns integer language sql security definer as $$
  select uses from public.invite_codes where code = 'T-DELACC'
$$;

select tests.member('ida@delete.test') as ida_id \gset
select tests.member('max@delete.test') as max_id \gset
select ((now() at time zone 'utc')::date - 3)::date as three_days_ago \gset
select gen_random_uuid() as write_req \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Ida: a read-and-rated Book, one she is reading with progress, a manual Book,
-- a collection holding one, a queued write that went through. Max: the same
-- Catalogue Book as Ida's, a manual Book, a collection.
select tests.act_as(:'ida_id');
select (public.add_to_library(
  '{"title":"Dune","source":"apple","apple_id":"990000101001","page_count":600}',
  'finished', :'three_days_ago'::date, :'three_days_ago'::date, 18, 'Spice.')).id as dune \gset
select (public.add_to_library(
  '{"title":"Kindred","source":"apple","apple_id":"990000101002","page_count":300}',
  'reading', :'three_days_ago'::date)).id as kindred \gset
select public.sync_write(gen_random_uuid(), 'update_progress',
  format('{"p_entry_id":"%s","p_page":50,"p_day":"%s"}', :'kindred', :'three_days_ago')::jsonb);
select public.sync_write(:'write_req', 'update_progress',
  format('{"p_entry_id":"%s","p_page":120,"p_day":"%s"}', :'kindred', :'three_days_ago')::jsonb);
select (public.add_manual_book('Ida''s own book', array['Ida'], null, 100)).book_id as ida_manual \gset
select (public.create_collection('Ida''s shelf')).id as ida_shelf \gset
select public.add_to_collection(:'ida_shelf',
  '{"title":"Dune","source":"apple","apple_id":"990000101001","page_count":600}');

select tests.act_as(:'max_id');
select (public.add_to_library(
  '{"title":"Dune","source":"apple","apple_id":"990000101001","page_count":600}', 'want_to_read')).id as max_dune \gset
select (public.add_manual_book('Max''s own book', array['Max'], null, 100)).book_id as max_manual \gset
select (public.create_collection('Max''s shelf')).id as max_shelf \gset
select public.add_to_collection(:'max_shelf',
  '{"title":"Dune","source":"apple","apple_id":"990000101001","page_count":600}');
reset role;

-- Sign-in state Supabase keeps for Ida.
insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
values (gen_random_uuid(), :'ida_id', :'ida_id', 'email', '{}'::jsonb, now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at)
values (gen_random_uuid(), :'ida_id', now(), now());

select tests.invite_uses() as uses_before \gset
select tests.total(:'ida_id') as ida_total \gset

-- ------------------------------------------------------------------ before

select ok(tests.total(:'ida_id') > 8, 'Ida owns a Library, reads, a collection, a manual Book, a record, a sign-in');
select is(tests.days_of(:'ida_id'), 1::bigint, 'a progress day');
select is(tests.in_collections(:'ida_id'), 1::bigint, 'a collection holding a Book');

-- ------------------------------------------------------------ the refusals

select tests.act_as(null);
select throws_ok($$ select public.delete_my_account() $$, '42501', 'not_signed_in', 'a caller with no member is refused');
reset role;
select is(tests.total(:'ida_id'), :'ida_total'::bigint, 'and nothing was deleted');

set local role anon;
select throws_ok($$ select public.delete_my_account() $$, '42501', NULL, 'anon cannot call it at all');
reset role;

select is(
  (select count(*) from pg_proc where proname = 'delete_my_account' and pronargs <> 0),
  0::bigint, 'it takes no argument: there is no way to name another member');

-- ------------------------------------------------------------ the deletion

select tests.act_as(:'ida_id');
select lives_ok($$ select public.delete_my_account() $$, 'Ida deletes her account');
reset role;

select is(tests.total(:'ida_id'), 0::bigint, 'nothing of Ida remains: sign-in, account, Library, reads, collections, manual Books, record');
select is((select count(*) from tests.owned(:'ida_id') where n <> 0), 0::bigint, 'in any of the tables');
select is(tests.days_of(:'ida_id'), 0::bigint, 'her progress days went with her reads');
select is(tests.in_collections(:'ida_id'), 0::bigint, 'her collection memberships went with the collection');
select is((select count(*) from public.books where id = :'ida_manual'), 0::bigint, 'her manual Book is gone');

-- ------------------------------------------------------------ what stays

select is(tests.books_with('990000101001'), 1::bigint, 'the shared Catalogue Book stays');
select is(tests.entries_on('990000101001'), 1::bigint, 'and only Max''s entry is on it now');
select is(tests.invite_uses(), :uses_before, 'the invite code stays as it was');
select is((select count(*) from public.invite_codes where code = 'T-DELACC'), 1::bigint, 'and exists');

-- ------------------------------------------------------------ others untouched

select is((select count(*) from tests.owned(:'max_id') where what = 'users' and n = 1), 1::bigint, 'Max still signs in');
select is((select count(*) from public.library_entries where id = :'max_dune'), 1::bigint, 'Max''s Library is as it was');
select is((select count(*) from public.books where id = :'max_manual'), 1::bigint, 'his manual Book too');
select is(tests.in_collections(:'max_id'), 1::bigint, 'and his collection with its Book');

-- ------------------------------------------------------- once only

select tests.act_as(:'ida_id');
select lives_ok($$ select public.delete_my_account() $$, 'a second call from the same token deletes nothing more');
reset role;
select is((select count(*) from tests.owned(:'max_id') where what = 'users' and n = 1), 1::bigint, 'and certainly not Max');

select * from finish();
rollback;
