-- Social v1, D2: following (docs/proposals/social-v1-contract.md §1.5 "D2"):
--   supabase test db
--
-- A follow link opens a private member's card and lets a member ask; she accepts or declines,
-- and a declined request looks to the asker like one still waiting. A public member is
-- followed at once by anyone who reaches her. Following back asks a private follower like
-- anyone else (owner, social-v1.md B 9). A new link forgets who only opened the old one. Unfollow, remove
-- and block are silent; a block cuts both ways and closes her link to him. Limits stop a
-- script. Nobody can follow, or learn of, a member they never reached. Assertions ask about
-- rows this test made, never counts of a table.

begin;
select plan(55);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-2', 'social follows test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-2', 'name', p_name)), now(), now(), now());
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

-- Past RLS, for the assertions.
create or replace function tests.viewed(p_visitor uuid, p_member uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.follow_link_views where visitor_id = p_visitor and member_id = p_member)
$$;

-- A list of cards holds this member.
create or replace function tests.has_member(p_list jsonb, p_member uuid)
returns boolean language sql as $$ select coalesce(p_list @> jsonb_build_array(jsonb_build_object('id', p_member)), false) $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant select on ids to authenticated, anon;
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@social2.pgtap.test', 'Ada')),
  ('pia', tests.member('pia@social2.pgtap.test', 'Pia')),
  ('ben', tests.member('ben@social2.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@social2.pgtap.test', 'Cy')),
  ('dan', tests.member('dan@social2.pgtap.test', 'Dan')),
  ('eve', tests.member('eve@social2.pgtap.test', 'Eve')),
  ('fen', tests.member('fen@social2.pgtap.test', 'Fen')),
  ('gil', tests.member('gil@social2.pgtap.test', 'Gil'));

-- Ada is private (the default), Pia public.
select tests.act_as((select id from ids where name = 'ada'));
insert into links values ('ada', (select public.my_social() ->> 'link'));
select tests.act_as((select id from ids where name = 'pia'));
select public.set_private(false);
insert into links values ('pia', (select public.my_social() ->> 'link'));

-- ---------------------------------------------------------------- follow_target

select tests.act_as((select id from ids where name = 'ben'));
select is(public.follow_target('nope'), null::jsonb, 'a malformed link finds nobody');
select is(public.follow_target('AAAAAAAAAAAAAAAAAAAAAA'), null::jsonb, 'an unknown link finds nobody');
select is(public.follow_target((select link from links where name = 'ada')) ->> 'state', 'none', 'her link opens her card');
select is(public.follow_target((select link from links where name = 'ada')) -> 'private', 'true'::jsonb, 'the card says she is private');
select is(public.follow_target((select link from links where name = 'ada')) -> 'member' ->> 'name', 'Ada', 'with her first name');
select ok(position('social2.pgtap.test' in public.follow_target((select link from links where name = 'ada'))::text) = 0,
  'and never her address');
select ok(tests.viewed((select id from ids where name = 'ben'), (select id from ids where name = 'ada')),
  'opening it is remembered');

select tests.act_as((select id from ids where name = 'ada'));
select is(public.follow_target((select link from links where name = 'ada')) ->> 'state', 'self', 'her own link is herself');

-- --------------------------------------------------------- asking and answering

select tests.act_as((select id from ids where name = 'ben'));
select is(public.follow((select id from ids where name = 'ada')) ->> 'state', 'requested', 'a private member is asked');
select is(public.follow((select id from ids where name = 'ada')) ->> 'state', 'requested', 'asking again changes nothing');
select is(public.follow_target((select link from links where name = 'ada')) ->> 'state', 'requested', 'her card says Requested');
select ok(tests.has_member(public.my_people() -> 'requested', (select id from ids where name = 'ada')), 'he sees his own request');

select tests.act_as((select id from ids where name = 'cy'));
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'ada')),
  'PT404', 'not_found', 'a member who never opened her link cannot ask');

select tests.act_as((select id from ids where name = 'ada'));
select ok(tests.has_member(public.my_people() -> 'requests', (select id from ids where name = 'ben')), 'she sees the request');
select is(public.my_social() -> 'requests', '1'::jsonb, 'and its count');
select throws_ok(format($$ select public.answer_request(%L, true) $$, (select id from ids where name = 'cy')),
  'PT404', 'not_found', 'there is nothing to answer from a member who did not ask');
select public.answer_request((select id from ids where name = 'ben'), true);
select ok((public.my_people() -> 'followers') @> jsonb_build_array(jsonb_build_object(
  'id', (select id from ids where name = 'ben'), 'followsBack', false)), 'accepted, he is her follower');
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'ada')),
  '22023', 'follow_self', 'she cannot follow herself');

select tests.act_as((select id from ids where name = 'ben'));
select ok(tests.has_member(public.my_people() -> 'following', (select id from ids where name = 'ada')), 'and she is in his Following');
select is(public.follow_target((select link from links where name = 'ada')) ->> 'state', 'following', 'her card says Following');

-- --------------------------------------------------------------- a public member

select tests.act_as((select id from ids where name = 'cy'));
select is(public.follow((select id from ids where name = 'pia')) ->> 'state', 'following', 'a public member is followed at once');

-- ---------------------------------------------------------------------- declined

select tests.act_as((select id from ids where name = 'dan'));
select public.follow_target((select link from links where name = 'ada'));
select public.follow((select id from ids where name = 'ada'));
select tests.act_as((select id from ids where name = 'ada'));
select public.answer_request((select id from ids where name = 'dan'), false);
select ok(not tests.has_member(public.my_people() -> 'requests', (select id from ids where name = 'dan')), 'declined, it leaves her requests');

select tests.act_as((select id from ids where name = 'dan'));
select ok(tests.has_member(public.my_people() -> 'requested', (select id from ids where name = 'ada')), 'he still sees it as asked');
select is(public.follow((select id from ids where name = 'ada')) ->> 'state', 'requested', 'asking again still says requested');
select ok(position('declin' in public.my_people()::text) = 0 and position('declin' in public.follow_target((select link from links where name = 'ada'))::text) = 0,
  'nothing tells him she declined');
select public.withdraw_request((select id from ids where name = 'ada'));
select ok(not tests.has_member(public.my_people() -> 'requested', (select id from ids where name = 'ada')), 'he withdraws it');

-- ------------------------------------------------------------------ follow back

select tests.act_as((select id from ids where name = 'ada'));
select is(public.follow((select id from ids where name = 'ben')) ->> 'state', 'requested',
  'following back a private follower asks him, as anyone would');
select tests.act_as((select id from ids where name = 'ben'));
select public.answer_request((select id from ids where name = 'ada'), true);
select ok((public.my_people() -> 'followers') @> jsonb_build_array(jsonb_build_object(
  'id', (select id from ids where name = 'ada'), 'followsBack', true)), 'he sees she follows him, and that he follows back');

-- -------------------------------------------------------- unfollow and remove

select public.unfollow((select id from ids where name = 'ada'));
select tests.act_as((select id from ids where name = 'ada'));
select ok(not tests.has_member(public.my_people() -> 'followers', (select id from ids where name = 'ben')), 'he unfollows her');

select tests.act_as((select id from ids where name = 'pia'));
select public.remove_follower((select id from ids where name = 'cy'));
select tests.act_as((select id from ids where name = 'cy'));
select ok(not tests.has_member(public.my_people() -> 'following', (select id from ids where name = 'pia')), 'she removes a follower');

-- ------------------------------------------------------------------------ block

select tests.act_as((select id from ids where name = 'ada'));
select public.block((select id from ids where name = 'ben'));
select ok(not tests.has_member(public.my_people() -> 'following', (select id from ids where name = 'ben')), 'a block ends her follow of him');
select ok(tests.has_member(public.my_blocked(), (select id from ids where name = 'ben')), 'he is in her Blocked list');
select ok(not tests.viewed((select id from ids where name = 'ben'), (select id from ids where name = 'ada')), 'and his view of her link is forgotten');
select throws_ok(format($$ select public.block(%L) $$, (select id from ids where name = 'ada')),
  '22023', 'follow_self', 'she cannot block herself');

select tests.act_as((select id from ids where name = 'ben'));
select is(public.follow_target((select link from links where name = 'ada')), null::jsonb, 'blocked, her link finds nobody for him');
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'ada')),
  'PT404', 'not_found', 'and he cannot ask');

select tests.act_as((select id from ids where name = 'ada'));
select public.unblock((select id from ids where name = 'ben'));
select is(public.my_blocked(), '[]'::jsonb, 'she unblocks him');
select tests.act_as((select id from ids where name = 'ben'));
select isnt(public.follow_target((select link from links where name = 'ada')), null::jsonb, 'and her link opens again');

-- ------------------------------------------------------------------- new link

select tests.act_as((select id from ids where name = 'gil'));
select public.follow_target((select link from links where name = 'ada'));
select tests.act_as((select id from ids where name = 'ada'));
select public.renew_follow_link();
select tests.act_as((select id from ids where name = 'gil'));
select is(public.follow_target((select link from links where name = 'ada')), null::jsonb, 'a renewed link finds nobody');
select ok(not tests.viewed((select id from ids where name = 'gil'), (select id from ids where name = 'ada')),
  'and who only opened the old one is forgotten');

-- ----------------------------------------------------------------------- limits

reset role;
insert into private.follow_calls (member_id) select (select id from ids where name = 'eve') from generate_series(1, 30);
select tests.act_as((select id from ids where name = 'eve'));
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'pia')),
  'PT429', 'rate_limited', 'thirty follow calls an hour are the most');

reset role;
-- Fen has twenty open requests to private members whose links she opened.
do $$
declare v_member uuid; v_fen uuid := (select id from ids where name = 'fen');
begin
  for i in 1..21 loop
    v_member := tests.member(format('m%s@social2.pgtap.test', i));
    insert into ids values (format('m%s', i), v_member);
    insert into public.follow_link_views (visitor_id, member_id) values (v_fen, v_member);
    if i <= 20 then
      insert into public.follows (follower_id, followee_id) values (v_fen, v_member);
    end if;
  end loop;
end;
$$;
select tests.act_as((select id from ids where name = 'fen'));
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'm21')),
  'PT429', 'follow_limit', 'twenty open requests are the most');

-- ------------------------------------------- an unknown id answers as a private stranger does

select tests.act_as((select id from ids where name = 'cy'));
select throws_ok(format($$ select public.follow(%L) $$, gen_random_uuid()),
  'PT404', 'not_found', 'following an id nobody has: not_found');
select throws_ok(format($$ select public.block(%L) $$, gen_random_uuid()),
  'PT404', 'not_found', 'blocking an id nobody has: not_found');
select throws_ok(format($$ select public.block(%L) $$, (select id from ids where name = 'ada')),
  'PT404', 'not_found', 'blocking a private member he never reached: the same not_found');

-- Gate 2: follow() asks "reachable" again once it holds the pair's lock, so a block that was
-- committed while it waited cannot be followed through. A second session is not at hand here, so
-- the order inside the function is what is checked: the second look comes after the lock.
select ok(
  position('blocked_either' in substr(pg_get_functiondef('public.follow(uuid)'::regprocedure),
             position('pair:' in pg_get_functiondef('public.follow(uuid)'::regprocedure)))) > 0,
  'follow looks for a block again after taking the pair''s lock');

-- S1: follow_target held no lock, so a block committed between its look and its insert could not see
-- (and delete) the link view it wrote. Same order as follow's: the pair's lock, then a second look
-- for a block, then the insert. The second session is not at hand here, so the order is what is checked.
select ok(
  position('pair:' in pg_get_functiondef('public.follow_target(text)'::regprocedure)) > 0
  and position('pg_advisory_xact_lock' in pg_get_functiondef('public.follow_target(text)'::regprocedure)) > 0,
  'follow_target takes the pair''s advisory lock, the one follow and block take');
select ok(
  (select position('blocked_either' in substr(d, position('pg_advisory_xact_lock' in d))) > 0
          and position('insert into public.follow_link_views' in d)
              > position('pg_advisory_xact_lock' in d) + position('blocked_either' in substr(d, position('pg_advisory_xact_lock' in d)))
     from (select pg_get_functiondef('public.follow_target(text)'::regprocedure) d) f),
  'and looks for a block again after the lock, before it writes the view');

-- S1: "already following" is answered before the limits (§1.5), also at 150 follows, and counts nothing.
reset role;
insert into ids values ('hal', tests.member('hal@social2.pgtap.test', 'Hal'));
with t as (
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  select gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         format('t%s@social2.pgtap.test', i), '{"invite_code": "T-SOCIAL-2"}'::jsonb, now(), now()
    from generate_series(1, 150) i
  returning id)
insert into public.follows (follower_id, followee_id, accepted_at)
select (select id from ids where name = 'hal'), id, now() from t;
insert into ids values ('hal-followed', (select followee_id from public.follows where follower_id = (select id from ids where name = 'hal') limit 1));
insert into ids values ('hal-new', tests.member('halnew@social2.pgtap.test', 'New'));
insert into public.social_settings (member_id, private, follow_token)
values ((select id from ids where name = 'hal-new'), false, private.reading_page_token());
select is((select count(*)::int from public.follows where follower_id = (select id from ids where name = 'hal')), 150, 'Hal follows 150 members');
select tests.act_as((select id from ids where name = 'hal'));
select is(public.follow((select id from ids where name = 'hal-followed')) ->> 'state', 'following',
  'at 150 follows, a member he already follows is "following", not follow_limit');
select throws_ok(format($$ select public.follow(%L) $$, (select id from ids where name = 'hal-new')),
  'PT429', 'follow_limit', 'while a new one is still refused');
reset role;
select is((select count(*)::int from private.follow_calls where member_id = (select id from ids where name = 'hal')), 0,
  'and answering "following" logged no call');

-- ---------------------------------------------------------------- signed out

select tests.act_anon();
select throws_ok($$ select public.follow_target('AAAAAAAAAAAAAAAAAAAAAA') $$, '42501', null, 'signed out, no link opens');
select throws_ok($$ select public.my_people() $$, '42501', null, 'signed out, no people');
select is(
  (select count(*)::int from unnest(array[
      'public.follow_target(text)', 'public.follow(uuid)', 'public.withdraw_request(uuid)', 'public.answer_request(uuid, boolean)',
      'public.unfollow(uuid)', 'public.remove_follower(uuid)', 'public.block(uuid)', 'public.unblock(uuid)',
      'public.my_people()', 'public.my_blocked()', 'public.renew_follow_link()'
    ]) f where has_function_privilege('anon', f::regprocedure, 'execute')),
  0, 'signed out, none of the follow functions can be executed');

select * from finish();
rollback;
