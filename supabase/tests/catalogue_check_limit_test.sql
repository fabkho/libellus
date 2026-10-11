-- A member cannot flood the Catalogue (social v2a contract §5; review MEDIUM "flooding"):
--   supabase test db
--
-- At most 200 new Catalogue Books per member per day, counted in catalogue_book_for: the 201st is
-- refused with `catalogue_limit` (PT429) and the whole add rolls back; a Book the Catalogue has
-- already costs nothing; the count is per member and per day. The check's queue claims oldest
-- first, legacy rows included, so a flood waits behind the Books that were there before it.

begin;
select plan(13);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-LIMIT-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-LIMIT-1', 'name', p_name)), now(), now(), now());
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
  ('ada', tests.member('ada@limit.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@limit.pgtap.test', 'Ben'));

-- ------------------------------------------------------- 200 a day

select tests.act_as((select id from ids where name = 'ada'));
select is((select count(*)::int from (select public.add_to_library(tests.snap('Flood ' || i), 'want_to_read', null) from generate_series(1, 200) i) x), 200,
  'a member adds 200 new Catalogue Books in a day');
select throws_ok(
  $$ select public.add_to_library(tests.snap('Flood 201'), 'want_to_read', null) $$,
  'PT429', 'catalogue_limit', 'the 201st is refused: catalogue_limit, as a 429');
select is((select count(*)::int from public.library_entries where member_id = (select id from ids where name = 'ada')), 200,
  'and the add rolled back whole: no entry');
reset role;
select is((select count(*)::int from public.books where title = 'Flood 201'), 0, 'nor a Book');
select is((select n from private.catalogue_additions where member_id = (select id from ids where name = 'ada') and day = current_date), 200,
  'the day''s count stays at 200');

select tests.act_as((select id from ids where name = 'ben'));
select is((public.add_to_library(tests.snap('Ben Own'), 'want_to_read', null)).id is not null, true, 'another member is not limited by hers');
select tests.act_as((select id from ids where name = 'ada'));
select is((select count(*)::int from public.library_entries where member_id = (select id from ids where name = 'ada')), 200, 'she still has 200');

-- The same Book by its ISBN as one that is there already is no new Book.
reset role;
update public.books set isbn13 = '9780141439518' where title = 'Flood 1';
select tests.act_as((select id from ids where name = 'ada'));
select throws_ok(
  $$ select public.add_to_library(tests.snap('Flood new') || '{"isbn13":"9780141439600"}', 'want_to_read', null) $$,
  'PT429', 'catalogue_limit', 'a new Book is still refused');
select tests.act_as((select id from ids where name = 'ben'));
select lives_ok(
  $$ select public.add_to_library(tests.snap('Flood 1 again') || '{"isbn13":"9780141439518"}', 'want_to_read', null) $$,
  'an existing Book (by ISBN) is added by another member');

-- ------------------------------------------------------- the next day

reset role;
update private.catalogue_additions set day = current_date - 1 where member_id = (select id from ids where name = 'ada');
select tests.act_as((select id from ids where name = 'ada'));
select lives_ok(
  $$ select public.add_to_library(tests.snap('Flood 202'), 'want_to_read', null) $$,
  'the next day she can add again');
reset role;
select is((select n from private.catalogue_additions where member_id = (select id from ids where name = 'ada') and day = current_date), 1,
  'the day''s count starts again');
update private.catalogue_additions set day = current_date - 9 where member_id = (select id from ids where name = 'ada') and day <> current_date;
select tests.act_as((select id from ids where name = 'ada'));
select public.add_to_library(tests.snap('Flood 203'), 'want_to_read', null);
reset role;
select is((select count(*)::int from private.catalogue_additions where member_id = (select id from ids where name = 'ada')), 1,
  'days older than a week are dropped');

-- ------------------------------------------------------ the queue, oldest first

update public.books set created_at = now() - interval '3 days' where title = 'Flood 5';
update public.books set created_at = now() - interval '2 days' where title = 'Flood 2';
update public.books set created_at = now() - interval '1 day' where title = 'Flood 9';
select is((select array_agg(title order by title) from public.catalogue_check_claim(3) where owner_id is null),
  array['Flood 2', 'Flood 5', 'Flood 9'], 'the claim takes the oldest Books first, not the newest');

select * from finish();
rollback;
