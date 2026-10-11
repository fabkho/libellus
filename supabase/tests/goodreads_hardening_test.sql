-- Goodreads hardening (security round F2, F3, F16): supabase test db
--
--   F3  the title cache is closed to members; the Library's rating relationship reads the ISBN table only
--   F2  the ISBN cache refuses a row a title search found, and the migration purges the old ones
--   F16 edge_rate_hit counts calls per member and bucket in a window; only the service role calls it,
--       and member A can neither see nor reset member B's counter

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-GR-HARD', 'goodreads hardening test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-GR-HARD"}'::jsonb, now(), now(), now());
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

select tests.member('ida@gr-hard.test') as ida_id \gset
select tests.member('max@gr-hard.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------------ F3 / F2

-- A Manual book's title as the old client would have sent it to the title cache.
insert into public.goodreads_title_ratings (title_key, status)
values ('zzz private diary|zzzsurname', 'not_found');

select ok(
  (select prosrc !~ 'goodreads_title_ratings' and prosrc ~ 'goodreads_ratings'
     from pg_proc where oid = 'public.goodreads_rating(public.books)'::regprocedure),
  'the Library''s rating relationship reads the ISBN table only');

select tests.act_as(:'max_id');
select throws_ok(
  $$ select title_key from public.goodreads_title_ratings where title_key like 'zzz private%' $$,
  '42501', null, 'member B cannot see member A''s private Manual title');
reset role;

select throws_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count)
     values ('9798991230001', 'found', 'title', '234225', 4.28, 1200000) $$,
  '23514', null, 'a title-search answer cannot be stored under an ISBN');
select lives_ok(
  $$ insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count)
     values ('9798991230001', 'found', 'isbn', '234225', 4.28, 1200000) $$,
  'an ISBN answer can');

-- ---------------------------------------------------------------------- F16

select ok(
  not has_table_privilege('authenticated', 'public.edge_rate_limits', 'select')
  and not has_table_privilege('anon', 'public.edge_rate_limits', 'select'),
  'members and visitors have no grant on the counters');
select ok(
  not has_function_privilege('authenticated', 'public.edge_rate_hit(uuid,text,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.edge_rate_hit(uuid,text,integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.edge_rate_hit(uuid,text,integer,integer)', 'execute'),
  'only the service role counts');

set local role service_role;

select is(
  (select array_agg(public.edge_rate_hit(:'ida_id', 'goodreads-rating', 3, 60) order by n) from generate_series(1, 4) n),
  array[true, true, true, false],
  'the fourth call in a window of three is over the limit');
select is(public.edge_rate_hit(:'max_id', 'goodreads-rating', 3, 60), true,
  'another member has her own count');
select is(public.edge_rate_hit(:'ida_id', 'enrich', 3, 60), true,
  'and every bucket its own');
select is(public.edge_rate_hit(:'ida_id', 'goodreads-rating', 3, 60), false,
  'she stays over the limit until the window ends');

reset role;

-- The window ends: a call after it starts a new one.
update public.edge_rate_limits set window_start = now() - interval '61 seconds'
 where member_id = :'ida_id' and bucket = 'goodreads-rating';

set local role service_role;
select is(public.edge_rate_hit(:'ida_id', 'goodreads-rating', 3, 60), true, 'a new window starts at one call');
select is((select hits from public.edge_rate_limits where member_id = :'ida_id' and bucket = 'goodreads-rating'), 1,
  'with its count at one');
reset role;

-- Member A cannot see member B's counter, nor reset it.
select tests.act_as(:'ida_id');
select throws_ok(
  $$ select * from public.edge_rate_limits where member_id = '$$ || :'max_id' || $$' $$,
  '42501', null, 'a member cannot read the counters');
select throws_ok(
  $$ delete from public.edge_rate_limits $$,
  '42501', null, 'nor reset them');
select throws_ok(
  $$ select public.edge_rate_hit(gen_random_uuid(), 'enrich', 10, 60) $$,
  '42501', null, 'nor count for somebody else');
reset role;

-- Deleting the account takes the counters along.
delete from auth.users where id = :'max_id';
select is((select count(*)::integer from public.edge_rate_limits where member_id = :'max_id'), 0,
  'a deleted member''s counters go with her');

-- ----------------------------------------------------------------------- I2

select is(
  (select proconfig from pg_proc where oid = 'public.search_books(text, integer)'::regprocedure),
  array['search_path=pg_catalog, public, pg_temp'],
  'search_books searches pg_temp last');
select is(
  (select proconfig from pg_proc where oid = 'private.book_search_sync()'::regprocedure),
  array['search_path=pg_catalog, public, pg_temp'],
  'and so does the search trigger');

-- Ida's Manual book is hers alone; a temp table named like the real ones changes nothing for Cleo.
select tests.member('cleo@gr-hard.test') as cleo_id \gset
insert into public.books (title, authors, source, owner_id)
values ('Zzqvx privates Heft', '{Ida}', 'manual', :'ida_id');
insert into public.books (title, authors, source, apple_id)
values ('Zzqvx Katalogbuch', '{Ann Author}', 'apple', '990000099001');

select tests.act_as(:'cleo_id');
create temp table books (id uuid, title text);
create temp table book_search (book_id uuid, words tsvector, title text);
select is(
  (select array_agg(title order by title) from public.search_books('Zzqvx', 20)),
  array['Zzqvx Katalogbuch'],
  'a temp table named like the real ones does not shadow them; member A''s Manual book stays hers');
select is(
  (select count(*)::integer from public.search_books('Zzqvx privates Heft', 20) where owner_id is not null),
  0,
  'member B cannot find member A''s Manual book by its title');
reset role;
select tests.act_as(:'ida_id');
select is(
  (select count(*)::integer from public.search_books('Zzqvx privates Heft', 20)),
  1,
  'its owner does');
reset role;

select * from finish();
rollback;
