-- A member can block a co-member of a buddy read (migration 20261113050000_block_co_member.sql):
--   supabase test db
--
-- public.block used to answer not_found for a member with a PRIVATE profile whom the caller does not
-- follow, so a person who joined a room by its link (or hosts it) could not be blocked. Now two people
-- joined in one read can block each other; strangers, people who left and people who blocked the
-- caller first still get not_found; blocking again is idempotent. After the block her messages are
-- gone from the room for both and her Section from the card. Assertions ask about rows this test
-- made, never counts of a table.

begin;
select plan(33);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BLOCK-CO-1', 'block co-member test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-BLOCK-CO-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.snap(p_title text, p_work text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9800000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'openlibrary_work_key', p_work))
$$;

create or replace function tests.secs(p_n integer, p_prefix text default 'Section')
returns jsonb language sql as $$
  select jsonb_agg(x order by o)
    from (select k as o, jsonb_build_object('kind', 'part', 'label', p_prefix || ' ' || k,
                                            'to_fraction', round(k::numeric / p_n, 4)) as x
            from generate_series(1, p_n) k
          union all
          select p_n + 1, jsonb_build_object('kind', 'end', 'label', 'The whole book', 'to_fraction', 1)) s
$$;

-- A text message as the acting member; answers its id.
create or replace function tests.say(p_read uuid, p_section uuid, p_body text)
returns uuid language sql as $$
  select (public.post_buddy_message(p_read, p_section, gen_random_uuid(), 'text', p_body) ->> 'id')::uuid
$$;

-- The ids of a page.
create or replace function tests.ids(p_page jsonb)
returns uuid[] language sql as $$
  select coalesce(array_agg((m ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(p_page) with ordinality x(m, o)
$$;

-- A member's card in buddy_read()'s answer.
create or replace function tests.card(p_read jsonb, p_member uuid)
returns jsonb language sql as $$
  select c from jsonb_array_elements(p_read -> 'members') c where c ->> 'id' = p_member::text
$$;

-- What a statement raises: sqlstate and message, or 'ok'.
create or replace function tests.outcome(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create or replace function tests.section_ids(p_read uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.buddy_read_sections where buddy_read_id = p_read
$$;
create or replace function tests.blocks_of(p_blocker uuid, p_blocked uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.blocks where blocker_id = p_blocker and blocked_id = p_blocked
$$;
create or replace function tests.reachable(p_a uuid, p_b uuid)
returns boolean language sql security definer as $$ select private.reachable(p_a, p_b) $$;
create or replace function tests.co_members(p_a uuid, p_b uuid)
returns boolean language sql security definer as $$ select private.buddy_co_members(p_a, p_b) $$;
create or replace function tests.block_raw(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------------- members and the read

-- Vera blocks; Hana hosts; Ivo joins by the link; Kim blocks Vera first; Lu joins and leaves; Jo is in no
-- read; Mae hosts a read Vera is not in.
select tests.member('vera@blockco.pgtap.test', 'Vera') as vera \gset
select tests.member('hana@blockco.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@blockco.pgtap.test', 'Ivo') as ivo \gset
select tests.member('kim@blockco.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@blockco.pgtap.test', 'Lu') as lu \gset
select tests.member('jo@blockco.pgtap.test', 'Jo') as jo \gset
select tests.member('mae@blockco.pgtap.test', 'Mae') as mae \gset

-- Everybody has a private profile, and Vera follows nobody.
select tests.act_as(:'vera');  select public.set_private(true);
select tests.act_as(:'hana');  select public.set_private(true);
select tests.act_as(:'ivo');   select public.set_private(true);
select tests.act_as(:'kim');   select public.set_private(true);
select tests.act_as(:'lu');    select public.set_private(true);
select tests.act_as(:'jo');    select public.set_private(true);
select tests.act_as(:'mae');   select public.set_private(true);
reset role;

select tests.act_as(:'hana');
select (public.add_to_library(tests.snap('Block Co Dune'))).id as e_dune \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_dune'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_a, (:'v'::jsonb ->> 'link_token') as t_a \gset
select tests.act_as(:'mae');
select (public.add_to_library(tests.snap('Block Co Other'))).id as e_other \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_other'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_m from (select 1) x \gset
reset role;

select tests.act_as(:'vera'); select public.join_buddy_read(:'t_a');
select tests.act_as(:'ivo');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'kim');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'lu');   select public.join_buddy_read(:'t_a');
reset role;
select s[1] as a1 from (select tests.section_ids(:'r_a') s) x \gset

-- ------------------------------------------------------------------------- the bug, and the guard

select is(tests.reachable(:'vera', :'ivo'), false, 'Ivo is private and Vera does not follow him: not reachable');
select is(tests.reachable(:'vera', :'hana'), false, 'nor is Hana, the host');
select is(tests.co_members(:'vera', :'ivo'), true, 'but they are joined in one read');

-- Messages before the block: everybody sees everybody.
select tests.act_as(:'ivo');
select tests.say(:'r_a', null, 'Ivo in the room') as m_ivo_room \gset
select tests.say(:'r_a', :'a1', 'Ivo in Section 1') as m_ivo_sec \gset
select tests.act_as(:'hana');
select tests.say(:'r_a', null, 'Hana in the room') as m_hana_room \gset
select tests.act_as(:'vera');
select tests.say(:'r_a', null, 'Vera in the room') as m_vera_room \gset
select tests.say(:'r_a', :'a1', 'Vera in Section 1') as m_vera_sec \gset
select tests.act_as(:'kim');
select tests.say(:'r_a', null, 'Kim in the room') as m_kim_room \gset

select tests.act_as(:'vera');
select ok(tests.ids(public.buddy_read_messages(:'r_a')) @> array[:'m_ivo_room'::uuid, :'m_hana_room'::uuid],
  'before the block Vera reads Ivo and Hana in the room');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', '{"kind": "not_set"}'::jsonb,
  'and sees where Ivo is (not set yet)');

-- (a) a private co-member who is not followed is blockable
select is(tests.outcome(format('select public.block(%L)', :'ivo')), 'ok',
  '(a) a private co-member Vera does not follow can be blocked');
reset role;
select is(tests.blocks_of(:'vera', :'ivo'), 1, 'the block row is there');
select is(tests.co_members(:'vera', :'ivo'), false, 'and they are no co-members any more (blocked_either)');

-- (b) her messages vanish both ways
select tests.act_as(:'vera');
select ok(not (tests.ids(public.buddy_read_messages(:'r_a')) && array[:'m_ivo_room'::uuid]),
  '(b) Ivo''s room message is gone for Vera');
select ok(not (tests.ids(public.buddy_read_messages(:'r_a', :'a1')) && array[:'m_ivo_sec'::uuid]),
  'and his Section message');
select ok(tests.ids(public.buddy_read_messages(:'r_a')) @> array[:'m_hana_room'::uuid, :'m_vera_room'::uuid, :'m_kim_room'::uuid],
  'while the others'' and her own stay');
select tests.act_as(:'ivo');
select ok(not (tests.ids(public.buddy_read_messages(:'r_a')) && array[:'m_vera_room'::uuid]),
  'Vera''s room message is gone for Ivo');
select ok(not (tests.ids(public.buddy_read_messages(:'r_a', :'a1')) && array[:'m_vera_sec'::uuid]),
  'and her Section message');
select ok(tests.ids(public.buddy_read_messages(:'r_a')) @> array[:'m_ivo_room'::uuid, :'m_hana_room'::uuid],
  'while his own and Hana''s stay');
select tests.act_as(:'hana');
select ok(tests.ids(public.buddy_read_messages(:'r_a')) @> array[:'m_ivo_room'::uuid, :'m_vera_room'::uuid],
  'Hana still reads both');
select tests.act_as(:'vera');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', 'null'::jsonb, 'Vera no longer sees where Ivo is');
select tests.act_as(:'ivo');
select is(tests.card(public.buddy_read(:'r_a'), :'vera') -> 'where', 'null'::jsonb, 'nor Ivo where Vera is');
select ok((tests.card(public.buddy_read(:'r_a'), :'hana') -> 'where') is distinct from 'null'::jsonb,
  'Hana''s place is still shown to Ivo');

-- the host, too
select tests.act_as(:'vera');
select is(tests.outcome(format('select public.block(%L)', :'hana')), 'ok', 'the host, private and not followed, can be blocked');
select ok(not (tests.ids(public.buddy_read_messages(:'r_a')) && array[:'m_hana_room'::uuid]), 'and her message is gone for Vera');
reset role;

-- (c) a private member who is in no read with her is still not_found
select tests.act_as(:'vera');
select is(tests.outcome(format('select public.block(%L)', :'jo')), 'PT404 not_found', '(c) a private stranger is not_found');
select is(tests.outcome(format('select public.block(%L)', :'mae')), 'PT404 not_found',
  'and so is a private host of a read Vera is not in');
select is(tests.outcome(format('select public.block(%L)', :'lu')), 'ok', 'Lu is still in the room: blockable');
select tests.act_as(:'lu');
select public.leave_buddy_read(:'r_a');
reset role;
select tests.act_as(:'vera');
select public.unblock(:'lu');
select is(tests.outcome(format('select public.block(%L)', :'lu')), 'PT404 not_found',
  'once Lu has left, and no block stands, she is not_found again');
reset role;
select is(tests.blocks_of(:'vera', :'jo') + tests.blocks_of(:'vera', :'mae') + tests.blocks_of(:'vera', :'lu'), 0,
  'and no block row was made for the three');

-- (d) a member who blocked her first stays not_found
select tests.act_as(:'kim');
select is(tests.outcome(format('select public.block(%L)', :'vera')), 'ok', 'Kim, a private co-member, blocks Vera first');
select tests.act_as(:'vera');
select is(tests.outcome(format('select public.block(%L)', :'kim')), 'PT404 not_found', '(d) Vera blocking Kim is not_found: she cannot tell');
reset role;
select is(tests.blocks_of(:'vera', :'kim'), 0, 'and makes no row');

-- (e) blocking again is idempotent
select tests.act_as(:'vera');
select is(tests.outcome(format('select public.block(%L)', :'ivo')), 'ok', '(e) blocking Ivo again is fine');
reset role;
select is(tests.blocks_of(:'vera', :'ivo'), 1, 'and still one row');
select tests.act_as(:'ivo');
select public.leave_buddy_read(:'r_a');
select tests.act_as(:'vera');
select is(tests.outcome(format('select public.block(%L)', :'ivo')), 'ok', 'even after Ivo left the room: the block stands');

-- (f) grants and search path
reset role;
select is(
  (select count(*)::int from pg_proc where oid = 'public.block(uuid)'::regprocedure
    and (has_function_privilege('anon', oid, 'execute')
         or has_function_privilege('public', oid, 'execute')
         or not has_function_privilege('authenticated', oid, 'execute')
         or not prosecdef
         or proconfig is distinct from array['search_path=pg_catalog, public, private'])),
  0, '(f) block: members only, security definer, search path pinned');
select tests.act_anon();
select is(tests.outcome(format('select public.block(%L)', :'ivo')), '42501 permission denied for function block', 'anon cannot call it');
reset role;

select * from finish();
rollback;
