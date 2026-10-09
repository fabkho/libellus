-- Social v1, D1: her own settings, the tables' locks, hiding a Book, who may see a photo
-- (docs/proposals/social-v1-contract.md §1.2, §1.5 "D1"):
--   supabase test db
--
-- A member starts private with every section on and a follow link of 22 characters; only she
-- reads or changes her settings; a new link replaces the old one; going public accepts the
-- requests that wait (a declined one is deleted); the follow tables are closed to the API
-- roles; a Book can be hidden from followers, online and through sync_write; and a photo is for
-- the members she is connected to. Assertions ask about rows this test made, never counts of a
-- table.

begin;
select plan(32);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-1', 'social settings test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.entry(p_member uuid, p_title text)
returns uuid language plpgsql as $$
declare v_book uuid; v_entry uuid;
begin
  insert into public.books (title, authors, source, apple_id)
  values (p_title, array['An Author'], 'apple', (floor(random() * 1e9))::bigint::text)
  returning id into v_book;
  insert into public.library_entries (member_id, book_id) values (p_member, v_book) returning id into v_entry;
  return v_entry;
end;
$$;

-- Past RLS, for the assertions.
create or replace function tests.hidden(p_entry uuid)
returns boolean language sql security definer as $$ select hidden from public.library_entries where id = p_entry $$;
create or replace function tests.follow_state(p_follower uuid, p_followee uuid)
returns text language sql security definer as $$
  select case when accepted_at is not null then 'accepted' when declined_at is not null then 'declined' else 'requested' end
    from public.follows where follower_id = p_follower and followee_id = p_followee
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, anon;
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@social1.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@social1.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@social1.pgtap.test')),
  ('dan', tests.member('dan@social1.pgtap.test', 'Dan')),
  ('eve', tests.member('eve@social1.pgtap.test', 'Eve'));
insert into ids values ('ada_entry', tests.entry((select id from ids where name = 'ada'), 'Kindred'));

-- --------------------------------------------------------------------- tables

select has_table('public', 'social_settings', 'social_settings exists');
select has_table('public', 'follows', 'follows exists');
select has_table('public', 'blocks', 'blocks exists');
select has_table('public', 'follow_link_views', 'follow_link_views exists');
select has_column('public', 'library_entries', 'hidden', 'a Library entry can be hidden from followers');

-- ------------------------------------------------------------------ my_social

select tests.act_as((select id from ids where name = 'ada'));

select is(
  (select public.my_social() -> 'private'), 'true'::jsonb,
  'a member starts with a private account');
select is(
  (select public.my_social() -> 'sections'),
  '{"reading": true, "want": true, "finished": true, "ratings": true, "reviews": true, "abandoned": true, "year": true}'::jsonb,
  'every section is on by default');
select matches(
  (select public.my_social() ->> 'link'), '^[A-Za-z0-9_-]{22}$',
  'she has a follow link of 22 base64url characters');
insert into links values ('ada_first', (select public.my_social() ->> 'link'));
select is(
  (select public.my_social() ->> 'link'), (select link from links where name = 'ada_first'),
  'asking again gives the same link');
select is(
  (select public.my_social() -> 'requests'), '0'::jsonb,
  'nobody has asked to follow her yet');

select isnt(
  (select public.renew_follow_link() ->> 'link'), (select link from links where name = 'ada_first'),
  'a new link replaces the old one');

-- ------------------------------------------------------------------- sections

select is(
  (select public.set_social_sections('{"reviews": false}') -> 'sections'),
  '{"reading": true, "want": true, "finished": true, "ratings": true, "reviews": false, "abandoned": true, "year": true}'::jsonb,
  'a section switched off; the others keep their value');
select throws_ok(
  $$ select public.set_social_sections('{"diary": true}') $$, '22023', 'social_sections_invalid',
  'an unknown section is refused');
select throws_ok(
  $$ select public.set_social_sections('{"reviews": "no"}') $$, '22023', 'social_sections_invalid',
  'a section that is not a boolean is refused');

select is((select public.set_private(false) -> 'private'), 'false'::jsonb, 'she makes her account public');
select is((select public.set_private(true) -> 'private'), 'true'::jsonb, 'and private again');

-- -------------------------------------------- only she sees or changes hers

select tests.act_as((select id from ids where name = 'ben'));
select is_empty(
  format($$ select 1 from public.social_settings where member_id = %L $$, (select id from ids where name = 'ada')),
  'another member cannot read her settings');
select throws_ok($$ select 1 from public.follows $$, '42501', null, 'members cannot read follows directly');
select throws_ok($$ select 1 from public.blocks $$, '42501', null, 'members cannot read blocks directly');
select throws_ok($$ select 1 from public.follow_link_views $$, '42501', null, 'members cannot read link views directly');

select tests.act_anon();
select throws_ok($$ select public.my_social() $$, '42501', null, 'signed out, there are no settings to ask for');
reset role;

-- --------------------------------------------- going public accepts requests

insert into public.follows (follower_id, followee_id)
  values ((select id from ids where name = 'ben'), (select id from ids where name = 'ada'));
insert into public.follows (follower_id, followee_id, declined_at)
  values ((select id from ids where name = 'cy'), (select id from ids where name = 'ada'), now());

select tests.act_as((select id from ids where name = 'ada'));
select is((select public.my_social() -> 'requests'), '1'::jsonb, 'one request waits; a declined one does not count');
select public.set_private(false);
select is(
  tests.follow_state((select id from ids where name = 'ben'), (select id from ids where name = 'ada')), 'accepted',
  'going public accepts the request that waited');
select is(
  tests.follow_state((select id from ids where name = 'cy'), (select id from ids where name = 'ada')), null,
  'a declined request is gone once she is public');
select public.set_private(true);

-- -------------------------------------------------------------- hiding a Book

select public.set_entry_hidden((select id from ids where name = 'ada_entry'), true);
select ok(tests.hidden((select id from ids where name = 'ada_entry')), 'she hides a Book from followers');
select public.sync_write(gen_random_uuid(), 'set_entry_hidden',
  jsonb_build_object('p_entry', (select id from ids where name = 'ada_entry'), 'p_hidden', false));
select ok(not tests.hidden((select id from ids where name = 'ada_entry')), 'and shows it again through sync_write');

select tests.act_as((select id from ids where name = 'ben'));
select throws_ok(
  format($$ select public.set_entry_hidden(%L, true) $$, (select id from ids where name = 'ada_entry')),
  'P0002', 'entry_not_found', 'nobody hides a Book of someone else''s Library');

-- ------------------------------------------------------- who may see a photo

reset role;
insert into public.follow_link_views (visitor_id, member_id)
  values ((select id from ids where name = 'dan'), (select id from ids where name = 'ada'));
insert into public.blocks (blocker_id, blocked_id)
  values ((select id from ids where name = 'ada'), (select id from ids where name = 'ben'));

select tests.act_as((select id from ids where name = 'ada'));
select ok(public.can_see_member_photo((select id from ids where name = 'ada')), 'she sees her own photo');
select tests.act_as((select id from ids where name = 'dan'));
select ok(public.can_see_member_photo((select id from ids where name = 'ada')), 'a member who opened her link sees it');
select tests.act_as((select id from ids where name = 'eve'));
select ok(not public.can_see_member_photo((select id from ids where name = 'ada')), 'a stranger does not, while she is private');
select tests.act_as((select id from ids where name = 'ben'));
select ok(not public.can_see_member_photo((select id from ids where name = 'ada')), 'a blocked member does not, though he follows her');

select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(false);
select tests.act_as((select id from ids where name = 'eve'));
select ok(public.can_see_member_photo((select id from ids where name = 'ada')), 'any member does once she is public');

select * from finish();
rollback;
