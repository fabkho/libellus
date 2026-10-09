-- Social v1.1: People in pages (supabase/migrations/20261019020000_social_http_codes.sql):
--   supabase test db
--
-- my_people() answers the first page (30) of Following and Followers, newest follow first; the
-- rest comes through my_people_page(list, before, before_id, limit), a keyset like feed()'s, its
-- limit clamped. Requests and Requested stay whole. `followingIds` is everyone she follows; a row
-- carries `at` (the keyset) and followsYou / followsBack. Assertions ask about rows this test made.

begin;
select plan(21);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-PAGES', 'social people pages test', 200);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-PAGES', 'name', p_name)), now(), now(), now());
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

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temp table ids (name text primary key, id uuid not null);
grant all on ids to authenticated;

-- Ada, with 70 followers (the 3rd of them also followed by her) plus G35, and 40 members she follows, each
-- follow one minute apart: the later the number, the newer the follow.
insert into ids values ('ada', tests.member('ada@pages.pgtap.test', 'Ada'));
insert into ids select 'f' || i, tests.member(format('f%s@pages.pgtap.test', i), 'F' || i) from generate_series(1, 70) i;
insert into ids select 'g' || i, tests.member(format('g%s@pages.pgtap.test', i), 'G' || i) from generate_series(1, 40) i;
insert into ids values ('req', tests.member('req@pages.pgtap.test', 'Req'));

insert into public.follows (follower_id, followee_id, requested_at, accepted_at)
select (select id from ids where name = 'f' || i), (select id from ids where name = 'ada'),
       timestamptz '2026-01-01 10:00+00' + i * interval '1 minute',
       timestamptz '2026-01-01 10:00+00' + i * interval '1 minute'
  from generate_series(1, 70) i;
insert into public.follows (follower_id, followee_id, requested_at, accepted_at)
select (select id from ids where name = 'ada'), (select id from ids where name = 'g' || i),
       timestamptz '2026-02-01 10:00+00' + i * interval '1 minute',
       timestamptz '2026-02-01 10:00+00' + i * interval '1 minute'
  from generate_series(1, 40) i;
-- She follows f3 back (her oldest follow); g35 follows her too, a year ago.
insert into public.follows (follower_id, followee_id, accepted_at)
values ((select id from ids where name = 'ada'), (select id from ids where name = 'f3'), timestamptz '2025-12-01 10:00+00'),
       ((select id from ids where name = 'g35'), (select id from ids where name = 'ada'), now() - interval '1 year');
insert into public.follows (follower_id, followee_id) values ((select id from ids where name = 'req'), (select id from ids where name = 'ada'));

select tests.act_as((select id from ids where name = 'ada'));

-- ------------------------------------------------------------------------- the first page

select is(jsonb_array_length(public.my_people() -> 'followers'), 30, 'the first page of Followers is 30 rows');
select is(jsonb_array_length(public.my_people() -> 'following'), 30, 'and of Following');
select is(public.my_people() -> 'followers' -> 0 ->> 'name', 'F70', 'Followers: the newest follow first');
select is(public.my_people() -> 'following' -> 0 ->> 'name', 'G40', 'Following: the newest follow first');
select is(jsonb_array_length(public.my_people() -> 'followingIds'), 41, 'followingIds is everyone she follows, whole (G1-G40 and F3)');
select ok((public.my_people() -> 'following' -> 0) ? 'at', 'a row carries `at`, the keyset for the next page');
select is((select (e ->> 'followsYou')::boolean from jsonb_array_elements(public.my_people() -> 'following') e where e ->> 'name' = 'G35'),
  true, 'a Following row says whether that member follows her');
select is((select (e ->> 'followsYou')::boolean from jsonb_array_elements(public.my_people() -> 'following') e where e ->> 'name' = 'G40'),
  false, 'and when not');
select is(jsonb_array_length(public.my_people() -> 'requests'), 1, 'Requests are whole, not paged');

-- ------------------------------------------------------------------------- the next pages

create temp table seen (list text, page int, body jsonb);
grant all on seen to authenticated;
insert into seen select 'followers', 1, public.my_people() -> 'followers';
insert into seen select 'followers', 2,
  public.my_people_page('followers', (select (body -> 29 ->> 'at')::timestamptz from seen where page = 1 and list = 'followers'),
                        (select (body -> 29 ->> 'id')::uuid from seen where page = 1 and list = 'followers'));
insert into seen select 'followers', 3,
  public.my_people_page('followers', (select (body -> 29 ->> 'at')::timestamptz from seen where page = 2 and list = 'followers'),
                        (select (body -> 29 ->> 'id')::uuid from seen where page = 2 and list = 'followers'));

select is((select jsonb_array_length(body) from seen where list = 'followers' and page = 2), 30, 'the second page of Followers is 30 rows');
select is((select jsonb_array_length(body) from seen where list = 'followers' and page = 3), 11, 'the third holds the 11 left: fewer than the limit is the end');
select is((select body -> 0 ->> 'name' from seen where list = 'followers' and page = 2), 'F40', 'the second page goes on where the first ended');
select is((select count(distinct e ->> 'id')::int from seen, jsonb_array_elements(body) e where list = 'followers'), 71,
  'the three pages hold every follower once (70 and G35)');
select is((select (e ->> 'followsBack')::boolean from seen, jsonb_array_elements(body) e where list = 'followers' and e ->> 'name' = 'F3'),
  true, 'a Followers row says whether she follows back');
select is(public.my_people_page('following', (select (body -> 29 ->> 'at')::timestamptz from (select public.my_people() -> 'following' as body) s),
                                (select (body -> 29 ->> 'id')::uuid from (select public.my_people() -> 'following' as body) s)) -> 0 ->> 'name',
  'G10', 'Following pages the same way');

-- Equal timestamps are told apart by the id: no row twice, none missed.
reset role;
update public.follows set accepted_at = timestamptz '2026-03-01 10:00+00'
 where followee_id = (select id from ids where name = 'ada') and accepted_at is not null and follower_id in (select id from ids where name like 'f%' and name <> 'f3');
select tests.act_as((select id from ids where name = 'ada'));
select is(
  (select count(distinct e ->> 'id')::int
     from (select jsonb_array_elements(a || b || c) e
             from (select public.my_people_page('followers', null, null, 25) a) p1,
                  lateral (select public.my_people_page('followers', (a -> 24 ->> 'at')::timestamptz, (a -> 24 ->> 'id')::uuid, 25) b) p2,
                  lateral (select public.my_people_page('followers', (b -> 24 ->> 'at')::timestamptz, (b -> 24 ->> 'id')::uuid, 25) c) p3) x),
  71, 'with every follow at the same instant, three pages of 25 still hold each follower once');

-- ------------------------------------------------------------------------- the limit

select is(jsonb_array_length(public.my_people_page('followers', null, null, 500)), 50, 'a limit above 50 is 50');
select is(jsonb_array_length(public.my_people_page('followers', null, null, 0)), 1, 'a limit below 1 is 1');
select is(jsonb_array_length(public.my_people_page('followers', null, null, null)), 30, 'no limit is 30');
select throws_ok($$ select public.my_people_page('requests') $$, '22023', 'people_list_invalid', 'only Following and Followers page');

-- ------------------------------------------------------------------------- who may call

select tests.act_anon();
select throws_ok($$ select public.my_people_page('followers') $$, '42501', null, 'signed out, no page');

select * from finish();
rollback;
