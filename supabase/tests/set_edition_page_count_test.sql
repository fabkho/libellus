-- Filling an edition's page count where it is null (migration 20261121010000_set_edition_page_count.sql):
--   supabase test db
--
-- `private.set_edition_page_count(book, count)` is the one-off backfill's write, not a member's: it fills an
-- edition's `books.page_count` where it is null, answers whether it wrote, never replaces a count that is there,
-- holds the count to 1…99999, leaves the member's own `library_entries.page_count_override` alone, and no member
-- or anon may call it (no execute, and no usage on `private` either). Assertions ask about the rows this test
-- made, never about how many rows a table holds.

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-PAGE-BACKFILL', 'page count backfill test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-PAGE-BACKFILL"}'::jsonb, now(), now(), now());
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
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end;
$$;

create or replace function tests.outcome(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

select tests.member('ida@pagebackfill.test') as ida_id \gset

insert into public.books (title, authors, source, isbn13) values ('No Count', '{A}', 'import', '9783000000110') returning id as bare \gset
insert into public.books (title, authors, source, isbn13) values ('No Count Either', '{A}', 'import', '9783000000141') returning id as ceiling \gset
insert into public.books (title, authors, source, isbn13, page_count) values ('Has Count', '{A}', 'import', '9783000000127', 320) returning id as known \gset
insert into public.books (title, authors, source, owner_id) values ('Her Own', '{A}', 'manual', :'ida_id') returning id as manual \gset
insert into public.library_entries (member_id, book_id, page_count_override) values (:'ida_id', :'known', 500) returning id as known_entry \gset

-- ------------------------------------------------------------------ what it writes

select is(
  private.set_edition_page_count(:'bare', 384),
  true, 'a Book with no page count gets one, and the call answers that it wrote');
select is((select page_count from public.books where id = :'bare'), 384, 'the count is stored');

-- ------------------------------------------------------------------ what it never does

select is(
  private.set_edition_page_count(:'known', 250),
  false, 'a Book that has a page count is not written: the call answers false');
select is((select page_count from public.books where id = :'known'), 320, 'and its count is unchanged');

select is(
  private.set_edition_page_count(:'bare', 400),
  false, 'the Book filled a moment ago is no longer null either');
select is((select page_count from public.books where id = :'bare'), 384, 'so the count stays what it was: a second run writes nothing');

select is(
  private.set_edition_page_count(gen_random_uuid(), 384),
  false, 'a Book that does not exist answers false');

-- Her own total is not the edition's: the Book's count is what the function looks at, and the entry's override is
-- never read or written by it.
select is(
  private.set_edition_page_count(:'known', 999),
  false, 'a Book whose entry carries her own total is still not written');
select is((select page_count_override from public.library_entries where id = :'known_entry'), 500, 'and her own total is untouched');

-- ------------------------------------------------------------------ the range

select is(
  tests.outcome(format('select private.set_edition_page_count(%L, 0)', :'manual')),
  '22023 page_count_invalid', 'a count of 0 is refused');
select is(
  tests.outcome(format('select private.set_edition_page_count(%L, 100000)', :'manual')),
  '22023 page_count_invalid', 'a count of 100000 is refused');
select is(
  tests.outcome(format('select private.set_edition_page_count(%L, -1)', :'manual')),
  '22023 page_count_invalid', 'and a negative one');
select is(
  tests.outcome(format('select private.set_edition_page_count(%L, null)', :'manual')),
  '22023 page_count_invalid', 'a null is no count at all');
select is((select page_count from public.books where id = :'manual'), null, 'none of the four wrote anything');

select is(private.set_edition_page_count(:'manual', 1), true, 'the bottom of the range is a count');
select is((select page_count from public.books where id = :'manual'), 1, 'and 1 page is stored');
select is(private.set_edition_page_count(:'ceiling', 99999), true, 'the top of the range is a count too');
select is((select page_count from public.books where id = :'ceiling'), 99999, 'and 99999 is stored');

-- ------------------------------------------------------------------ who may call it

select ok(
  not has_function_privilege('anon', 'private.set_edition_page_count(uuid, integer)', 'execute')
  and not has_function_privilege('public', 'private.set_edition_page_count(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'private.set_edition_page_count(uuid, integer)', 'execute')
  and has_function_privilege('service_role', 'private.set_edition_page_count(uuid, integer)', 'execute'),
  'execute is the service role''s alone: not anon, not public, not a member');

select tests.act_as(:'ida_id');
select is(
  tests.outcome(format('select private.set_edition_page_count(%L, 200)', :'bare')),
  '42501 permission denied for schema private', 'a member cannot call it: she has no usage on private');
reset role;

select tests.act_anon();
select is(
  tests.outcome(format('select private.set_edition_page_count(%L, 200)', :'bare')),
  '42501 permission denied for schema private', 'anon cannot call it either');
reset role;

select * from finish();
rollback;
