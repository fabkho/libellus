-- Goodreads' rating for a Book without an ISBN, the cache keyed by title and authors:
--   supabase test db
--
-- `goodreads_title_ratings` is read and written only by the service role (the
-- goodreads-rating edge function): its keys hold the title and author surnames of
-- every Book a member opened, a private Manual book included (security round F3), so
-- no member reads it. A found row has what the page shows, a miss nothing but its
-- time. The ISBN cache keeps its rules (goodreads_ratings_test.sql): members still
-- read it, and the Library's goodreads_rating(books) reads that table only.

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GOODREADS-T', 'goodreads title test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GOODREADS-T"}'::jsonb, now(), now(), now());
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

select tests.member('ida@goodreads-title.test') as ida_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

insert into public.goodreads_title_ratings (title_key, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
values ('zzz test wicked way|zzzauthor', 'found', 'title', '32109569', 4.24, 146833, null),
       ('zzz test unknown|zzzauthor', 'not_found', null, null, null, null, null);

-- -------------------------------------------------------------------- shape

select has_table('public', 'goodreads_title_ratings', 'the cache exists');
select col_is_pk('public', 'goodreads_title_ratings', 'title_key', 'keyed by title and authors');
select col_type_is('public', 'goodreads_title_ratings', 'rating', 'numeric(3,2)', 'the rating has two decimals');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.goodreads_title_ratings'::regclass),
  'row level security is on');

-- ------------------------------------------------------------- constraints

select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status) values ('no author', 'not_found') $$,
  '23514', null, 'a key without an author is refused');
select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status, matched_by) values ('zzz a|zzz', 'found', 'title') $$,
  '23514', null, 'a found row without its figures is refused');
select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status, goodreads_id) values ('zzz a|zzz', 'not_found', '1') $$,
  '23514', null, 'a miss with figures is refused');
select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status, matched_by, goodreads_id, rating, ratings_count)
     values ('zzz a|zzz', 'found', 'isbn', '1', 4, 3) $$,
  '23514', null, 'only the title search fills it');
select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status) values ('zzz a|zzz', 'error') $$,
  '23514', null, 'a failure is never stored');

-- ------------------------------------------------------------------- members

select tests.act_as(:'ida_id');

-- Member A cannot see member B's row (or any row): not even the policy-free table.
select throws_ok(
  $$ select title_key from public.goodreads_title_ratings where title_key like 'zzz test%' $$,
  '42501', null, 'a member cannot read the cache: it holds Manual titles');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename = 'goodreads_title_ratings'),
  0, 'and no policy lets a member in');
select ok(
  not has_table_privilege('authenticated', 'public.goodreads_title_ratings', 'select'),
  'the select grant is gone');
select throws_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status) values ('zzz b|zzz', 'not_found') $$,
  '42501', null, 'a member cannot add to the cache');
select throws_ok(
  $$ update public.goodreads_title_ratings set rating = 1 where title_key = 'zzz test wicked way|zzzauthor' $$,
  '42501', null, 'nor change it');
select throws_ok(
  $$ delete from public.goodreads_title_ratings where title_key = 'zzz test wicked way|zzzauthor' $$,
  '42501', null, 'nor empty it');

reset role;

-- ------------------------------------------------------------------ visitors

set local role anon;

select throws_ok(
  $$ select 1 from public.goodreads_title_ratings $$,
  '42501', null, 'a visitor cannot read the cache');

reset role;

-- ------------------------------------------------------- the edge function

set local role service_role;

select lives_ok(
  $$ insert into public.goodreads_title_ratings (title_key, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
     values ('zzz test new|zzzauthor', 'found', 'title', '1', 3.5, 2, null)
     on conflict (title_key) do update set status = excluded.status $$,
  'the service role stores a rating found by title');
select lives_ok(
  $$ update public.goodreads_title_ratings
        set status = 'found', matched_by = 'title', goodreads_id = '1', rating = 3, ratings_count = 2,
            checked_at = now()
      where title_key = 'zzz test unknown|zzzauthor' $$,
  'and refreshes a miss that Goodreads now knows');

reset role;

select is(
  (select ratings_count from public.goodreads_title_ratings where title_key = 'zzz test unknown|zzzauthor'),
  2,
  'the refresh is stored');

-- The ISBN cache is as it was: still not writable by a member.
select tests.act_as(:'ida_id');
select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status) values ('9798991234597', 'not_found') $$,
  '42501', null, 'the ISBN cache still refuses a member');
select lives_ok(
  $$ select count(*) from public.goodreads_ratings $$,
  'and still lets her read it');
reset role;

select * from finish();
rollback;
