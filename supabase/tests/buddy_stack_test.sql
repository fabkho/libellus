-- Buddy reads, the whole stack (D1 to D5) in one walk, as `authenticated`:
--   supabase test db
--
-- Each of the five migrations was tested on a database holding its own base chain only; this file
-- crosses all of them in one read: D1 (rooms, members, the link, invitations, the card's `where`, the
-- sticky removal, account deletion), D2 (her Section from her reading progress), D3 (messages,
-- reactions, leaving with delete), D4 (live updates over the member topics), D5 (a block of a
-- co-member with a private profile). A member creates a read, invites, others join by the link, three
-- link an entry, two read on (D2 moves each Section), they post and react, one blocks another (D5 hides
-- `where` and messages both ways), the host removes one (a second join by the link is refused), one
-- leaves with her messages deleted, one deletes her account. Nothing may raise, and no payload a
-- member is given (the RPCs' answers, the Realtime events) holds a page, a percent, an entry id or a
-- Section's number from another member's reading, except the Section she is in (`where`).
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(65);

select (now() at time zone 'utc')::date as today \gset

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BUDDY-STACK-1', 'buddy stack test', 20);

create or replace function tests.member(p_email text, p_name text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_build_object('invite_code', 'T-BUDDY-STACK-1', 'name', p_name), now(), now(), now());
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

-- A Catalogue Book of 300 pages; the same title is the same Book.
create or replace function tests.bk(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9830000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'page_count', 300)
$$;

-- Three Sections ending at a third, two thirds and the end, and the whole book.
create or replace function tests.secs(p_n integer)
returns jsonb language sql as $$
  select jsonb_agg(x order by o)
    from (select k as o, jsonb_build_object('kind', 'part', 'label', 'Section ' || k,
                                            'to_fraction', round(k::numeric / p_n, 4)) as x
            from generate_series(1, p_n) k
          union all
          select p_n + 1, jsonb_build_object('kind', 'end', 'label', 'The whole book', 'to_fraction', 1)) s
$$;

create or replace function tests.card(p_read jsonb, p_member uuid)
returns jsonb language sql as $$
  select c from jsonb_array_elements(p_read -> 'members') c where c ->> 'id' = p_member::text
$$;

create or replace function tests.ids(p_page jsonb)
returns uuid[] language sql as $$
  select coalesce(array_agg((m ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(p_page) with ordinality x(m, o)
$$;

create or replace function tests.say(p_read uuid, p_section uuid, p_body text, p_reply uuid default null)
returns uuid language sql as $$
  select (public.post_buddy_message(p_read, p_section, gen_random_uuid(), 'text', p_body, p_reply) ->> 'id')::uuid
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

-- Past RLS.
create or replace function tests.thru(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select read_through from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.joined(p_read uuid, p_member uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member and joined_at is not null)
$$;
create or replace function tests.removed(p_read uuid, p_member uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from private.buddy_read_removed where buddy_read_id = p_read and member_id = p_member)
$$;
create or replace function tests.messages_of(p_read uuid, p_member uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where buddy_read_id = p_read and author_id = p_member
$$;
create or replace function tests.reactions_of(p_member uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_reactions where member_id = p_member
$$;
create or replace function tests.account_rows(p_member uuid)
returns integer language sql security definer as $$
  select (select count(*) from auth.users where id = p_member)::integer
       + (select count(*) from public.buddy_read_members where member_id = p_member)::integer
       + (select count(*) from public.buddy_messages where author_id = p_member)::integer
       + (select count(*) from public.buddy_reactions where member_id = p_member)::integer
$$;
create or replace function tests.section_id(p_read uuid, p_position integer)
returns uuid language sql security definer as $$
  select id from public.buddy_read_sections where buddy_read_id = p_read and position = p_position
$$;
create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
  on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null
$$;
create or replace function tests.read_exists(p_read uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.buddy_reads where id = p_read)
$$;

-- The members' topics and the events on them: a mark is a list of ids, `fresh` what came after it.
create table tests.members (id uuid primary key, name text not null);
create table tests.seen (id uuid primary key);
-- Everything a member was given, to be scanned at the end: who, what, the payload.
create table tests.log (n serial primary key, viewer uuid not null, what text not null, payload jsonb not null);

create or replace function tests.mark()
returns void language sql security definer as $$
  insert into tests.seen (id)
  select m.id from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
  on conflict do nothing
$$;
create or replace function tests.fresh()
returns table (member text, event text, payload jsonb) language sql security definer as $$
  select t.name, m.event, m.payload
    from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
   where m.extension = 'broadcast' and m.private
     and not exists (select 1 from tests.seen s where s.id = m.id)
$$;
create or replace function tests.heard(p_member text, p_event text)
returns integer language sql security definer as $$
  select count(*)::integer from tests.fresh() where member = p_member and event = p_event
$$;
-- All events on all the members' topics, as log rows (viewer: the topic's member).
create or replace function tests.log_events()
returns void language sql security definer as $$
  insert into tests.log (viewer, what, payload)
  select t.id, 'event ' || m.event, m.payload
    from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
   where m.extension = 'broadcast' and m.private and m.event <> 'probe'
$$;

-- Keep an answer for the scan: what she was given when she asked.
create or replace function tests.cap(p_viewer uuid, p_what text, p_payload jsonb)
returns jsonb language sql security definer as $$
  with ins as (insert into tests.log (viewer, what, payload) values (p_viewer, p_what, p_payload) returning 1)
  select p_payload
$$;

-- How many of the logged payloads show another member's reading: a key that holds a number of
-- pages, a percent, a position (the key names of the table's columns and of the entry), or any entry
-- id that is not the viewer's own. The viewer's own place (`me`) is hers to see.
create or replace function tests.leaks()
returns table (n integer, viewer uuid, what text, why text) language sql security definer as $$
  select l.n, l.viewer, l.what,
         case when (l.payload - 'me')::text ~ '"(page|pages|percent|entry|entry_id|auto|hand|auto_through|hand_through|read_through|fraction)":'
              then 'key' else 'entry id' end
    from tests.log l
   where (l.payload - 'me')::text ~ '"(page|pages|percent|entry|entry_id|auto|hand|auto_through|hand_through|read_through|fraction)":'
      or exists (select 1 from public.library_entries e
                  where e.member_id <> l.viewer and strpos(l.payload::text, e.id::text) > 0)
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- ------------------------------------------------------------------------- the members

-- Hana hosts; Ivo and Kim read on; Lu is removed; Mae leaves and deletes; Ola deletes her account.
-- Every profile is private but Kim's, and Hana follows Kim (an invitation goes to a member the host
-- follows); nobody else follows anybody: Ivo, private and not followed, is whom Kim blocks (D5).
select tests.member('hana@stack.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@stack.pgtap.test', 'Ivo') as ivo \gset
select tests.member('kim@stack.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@stack.pgtap.test', 'Lu') as lu \gset
select tests.member('mae@stack.pgtap.test', 'Mae') as mae \gset
select tests.member('ola@stack.pgtap.test', 'Ola') as ola \gset
insert into tests.members (id, name) values
  (:'hana', 'Hana'), (:'ivo', 'Ivo'), (:'kim', 'Kim'), (:'lu', 'Lu'), (:'mae', 'Mae'), (:'ola', 'Ola');

select tests.act_as(:'hana'); select public.set_private(true);
select tests.act_as(:'ivo');  select public.set_private(true);
select tests.act_as(:'lu');   select public.set_private(true);
select tests.act_as(:'mae');  select public.set_private(true);
select tests.act_as(:'ola');  select public.set_private(true);
reset role;

-- ------------------------------------------------------------------------- D1: create, invite, join

select tests.act_as(:'hana');
select (public.add_to_library(tests.bk('Stack Dune'))).id as e_hana \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_hana'),
                                gen_random_uuid(), tests.secs(3), '{}', true) as v \gset
select (:'v'::jsonb ->> 'id') as r, (:'v'::jsonb ->> 'link_token') as t \gset
select ok(:'r' is not null and :'t' is not null, 'Hana creates a read with a link');
select tests.cap(:'hana', 'create_buddy_read', :'v'::jsonb) is not null as _ \gset
reset role;
select tests.mark();

select tests.follow(:'hana', :'kim');
select is(tests.outcome(format('select public.invite_to_buddy_read(%L, array[%L]::uuid[])', :'r', :'kim')), 'ok',
  'Hana invites Kim');
select tests.act_as(:'kim');
select is(tests.outcome(format('select public.answer_buddy_invite(%L, true)', :'r')), 'ok', 'Kim accepts');
reset role;
select ok(tests.joined(:'r'::uuid, :'kim'), 'Kim is a member');

select tests.act_as(:'ivo');  select is(tests.outcome(format('select public.join_buddy_read(%L)', :'t')), 'ok', 'Ivo joins by the link');
select tests.act_as(:'lu');   select is(tests.outcome(format('select public.join_buddy_read(%L)', :'t')), 'ok', 'Lu joins by the link');
select tests.act_as(:'mae');  select is(tests.outcome(format('select public.join_buddy_read(%L)', :'t')), 'ok', 'Mae joins by the link');
select tests.act_as(:'ola');  select is(tests.outcome(format('select public.join_buddy_read(%L)', :'t')), 'ok', 'Ola joins by the link');
reset role;

-- Nobody has told where she is: `not_set` for all of them.
select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read', public.buddy_read(:'r')) as rd \gset
select is(tests.card(:'rd'::jsonb, :'ivo') -> 'where', '{"kind": "not_set"}'::jsonb, 'Ivo has no place yet');
reset role;

-- ------------------------------------------------------------------------- D1 + D2: link, progress

select tests.act_as(:'ivo');
select (public.add_to_library(tests.bk('Stack Dune'))).id as e_ivo \gset
select tests.act_as(:'kim');
select (public.add_to_library(tests.bk('Stack Dune'))).id as e_kim \gset
reset role;

select tests.act_as(:'hana'); select is(tests.outcome(format('select public.link_buddy_entry(%L, %L)', :'r', :'e_hana')), 'ok', 'Hana links her entry');
select tests.act_as(:'ivo');  select is(tests.outcome(format('select public.link_buddy_entry(%L, %L)', :'r', :'e_ivo')), 'ok', 'Ivo links his');
select tests.act_as(:'kim');  select is(tests.outcome(format('select public.link_buddy_entry(%L, %L)', :'r', :'e_kim')), 'ok', 'Kim links hers');
reset role;

select tests.act_as(:'hana'); select public.start_reading(:'e_hana'::uuid, :'today'::date - 3);
select tests.act_as(:'ivo');  select public.start_reading(:'e_ivo'::uuid, :'today'::date - 3);
select tests.act_as(:'kim');  select public.start_reading(:'e_kim'::uuid, :'today'::date - 3);
reset role;
select tests.mark();

-- Ivo reads to page 150 of 300 (half: the Section ending at a third is done), Kim to 210 (0.7: two done).
select tests.act_as(:'ivo'); select is(tests.outcome(format('select public.update_progress(%L, 150)', :'e_ivo')), 'ok', 'Ivo updates his progress');
select tests.act_as(:'kim'); select is(tests.outcome(format('select public.update_progress(%L, 210)', :'e_kim')), 'ok', 'Kim updates hers');
reset role;
select is(tests.thru(:'r'::uuid, :'ivo'), 1, 'D2 moved Ivo: one Section read');
select is(tests.thru(:'r'::uuid, :'kim'), 2, 'and Kim: two');
select is(tests.thru(:'r'::uuid, :'hana'), 0, 'Hana, started and not read on: none');

select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read', public.buddy_read(:'r')) as rd \gset
select is(tests.card(:'rd'::jsonb, :'ivo') -> 'where', '{"kind": "section", "section": 2}'::jsonb, 'Hana sees Ivo in Section 2');
select is(tests.card(:'rd'::jsonb, :'kim') -> 'where', '{"kind": "section", "section": 3}'::jsonb, 'and Kim in Section 3');
select is(tests.card(:'rd'::jsonb, :'hana') -> 'where', '{"kind": "section", "section": 1}'::jsonb, 'and herself in Section 1');
select tests.cap(:'hana', 'my_buddy_reads', public.my_buddy_reads()) is not null as _ \gset
reset role;

-- D4 on top of D2: the progress told the others (buddy_read.changed, the id and nothing else).
select ok(tests.heard('Hana', 'buddy_read.changed') >= 1, 'D4: the progress of Ivo and Kim reached Hana as buddy_read.changed');
select ok(tests.heard('Lu', 'buddy_read.changed') >= 1, 'and Lu');

-- ------------------------------------------------------------------------- D3: post, react, read

select tests.act_as(:'ivo');
select tests.say(:'r', null, 'Ivo in the room') as m_ivo_room \gset
select tests.say(:'r', tests.section_id(:'r'::uuid, 1), 'Ivo in Section 1') as m_ivo_sec \gset
select tests.act_as(:'kim');
select tests.say(:'r', null, 'Kim in the room', :'m_ivo_room') as m_kim_room \gset
select tests.act_as(:'hana');
select tests.say(:'r', null, 'Hana in the room') as m_hana_room \gset
select tests.act_as(:'mae');
select tests.say(:'r', null, 'Mae in the room') as m_mae_room \gset
select tests.act_as(:'ola');
select tests.say(:'r', null, 'Ola in the room') as m_ola_room \gset
select tests.act_as(:'lu');
select tests.say(:'r', null, 'Lu in the room') as m_lu_room \gset
reset role;
select ok(:'m_ivo_room' is not null and :'m_kim_room' is not null and :'m_hana_room' is not null, 'D3: they post, in the room and in a Section');

select tests.act_as(:'kim');
select is(tests.outcome(format($$ select public.react_to_buddy_message(%L, '❤️') $$, :'m_ivo_room')), 'ok', 'Kim reacts to Ivo');
select tests.act_as(:'mae');
select is(tests.outcome(format($$ select public.react_to_buddy_message(%L, '🔥') $$, :'m_hana_room')), 'ok', 'Mae reacts to Hana');
select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page \gset
select ok(tests.ids(:'page'::jsonb) @> array[:'m_ivo_room'::uuid, :'m_kim_room'::uuid, :'m_hana_room'::uuid, :'m_mae_room'::uuid],
  'Hana reads the room');
select tests.cap(:'hana', 'buddy_read', public.buddy_read(:'r')) as rd \gset
select ok((:'rd'::jsonb -> 'room' ->> 'count')::integer >= 6, 'the room''s count is on the read (D3 on D1''s buddy_read)');
select is(tests.outcome(format('select public.mark_buddy_read(%L, null, now())', :'r')), 'ok', 'Hana marks the room as read');
select tests.cap(:'hana', 'my_buddy_reads', public.my_buddy_reads()) is not null as _ \gset
reset role;

select tests.act_as(:'ivo');
select tests.cap(:'ivo', 'buddy_read', public.buddy_read(:'r')) as rd_ivo \gset
select tests.cap(:'ivo', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page_ivo \gset
select ok(tests.ids(:'page_ivo'::jsonb) @> array[:'m_kim_room'::uuid, :'m_hana_room'::uuid], 'Ivo reads the room too');
select is(tests.outcome(format($$ select public.report_buddy_message(%L, 'spam', 'a test') $$, :'m_lu_room')), 'ok', 'Ivo reports a message');
reset role;

-- ------------------------------------------------------------------------- D5 (with D1 and D3): a block

select tests.mark();
select tests.act_as(:'kim');
select tests.cap(:'kim', 'buddy_read', public.buddy_read(:'r')) as rd_kim \gset
select ok(tests.card(:'rd_kim'::jsonb, :'ivo') -> 'where' is distinct from 'null'::jsonb, 'before the block Kim sees where Ivo is');
select is(tests.outcome(format('select public.block(%L)', :'ivo')), 'ok',
  'D5: Kim blocks Ivo, a co-member with a private profile she does not follow');
select tests.cap(:'kim', 'buddy_read', public.buddy_read(:'r')) as rd_kim \gset
select tests.cap(:'kim', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page_kim \gset
select is(tests.card(:'rd_kim'::jsonb, :'ivo') -> 'where', 'null'::jsonb, 'Kim no longer sees where Ivo is');
select ok(not (tests.ids(:'page_kim'::jsonb) && array[:'m_ivo_room'::uuid]), 'nor his messages');
select ok(tests.ids(:'page_kim'::jsonb) @> array[:'m_kim_room'::uuid, :'m_hana_room'::uuid], 'while the others'' and her own stay');
select tests.say(:'r', null, 'Kim after the block') as m_kim_after \gset
select tests.act_as(:'ivo');
select tests.cap(:'ivo', 'buddy_read', public.buddy_read(:'r')) as rd_ivo \gset
select tests.cap(:'ivo', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page_ivo \gset
select is(tests.card(:'rd_ivo'::jsonb, :'kim') -> 'where', 'null'::jsonb, 'Ivo no longer sees where Kim is');
select ok(not (tests.ids(:'page_ivo'::jsonb) && array[:'m_kim_room'::uuid, :'m_kim_after'::uuid]), 'nor her messages');
select ok(tests.card(:'rd_ivo'::jsonb, :'hana') -> 'where' is distinct from 'null'::jsonb, 'Hana''s place is still Ivo''s to see');
select is(tests.outcome(format($$ select public.react_to_buddy_message(%L, '❤️') $$, :'m_kim_room')), 'PT404 not_found',
  'Ivo cannot react to a message of Kim''s any more: it is not there for him');
select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page \gset
select ok(tests.ids(:'page'::jsonb) @> array[:'m_ivo_room'::uuid, :'m_kim_room'::uuid, :'m_kim_after'::uuid], 'Hana reads both');
reset role;
select is(tests.heard('Ivo', 'message.new'), 0, 'D4: Kim''s post after the block did not reach Ivo');
select ok(tests.heard('Hana', 'message.new') >= 1, 'but it reached Hana');

-- ------------------------------------------------------------------------- D1: remove, and it sticks

select tests.act_as(:'hana');
select is(tests.outcome(format('select public.remove_from_buddy_read(%L, %L)', :'r', :'lu')), 'ok', 'Hana removes Lu');
reset role;
select ok(not tests.joined(:'r'::uuid, :'lu'), 'Lu is out');
select ok(tests.removed(:'r'::uuid, :'lu'), 'with the removal marker');
select tests.act_as(:'lu');
select is(tests.outcome(format('select public.join_buddy_read(%L)', :'t')), 'PT404 not_found', 'the link does not let her back in');
reset role;
select ok(not tests.joined(:'r'::uuid, :'lu'), 'she is still out');

-- ------------------------------------------------------------------------- D3: leave with delete

select ok(tests.messages_of(:'r'::uuid, :'mae') = 1 and tests.reactions_of(:'mae') = 1, 'Mae has a message and a reaction');
select tests.act_as(:'mae');
select is(tests.outcome(format('select public.leave_buddy_read(%L, true)', :'r')), 'ok', 'Mae leaves and deletes what she wrote');
reset role;
select ok(not tests.joined(:'r'::uuid, :'mae'), 'Mae is out');
select ok(tests.messages_of(:'r'::uuid, :'mae') = 0 and tests.reactions_of(:'mae') = 0, 'her message and her reaction are gone');
select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read_messages', public.buddy_read_messages(:'r')) as page \gset
select ok(not (tests.ids(:'page'::jsonb) && array[:'m_mae_room'::uuid]), 'and the room no longer shows her message');
reset role;

-- ------------------------------------------------------------------------- D1 + D3: her account goes

select ok(tests.messages_of(:'r'::uuid, :'ola') = 1, 'Ola has a message');
select tests.act_as(:'ola');
select lives_ok($$ select public.delete_my_account() $$, 'Ola deletes her account');
reset role;
select is(tests.account_rows(:'ola'), 0, 'nothing of hers is left: account, membership, messages, reactions');
select ok(tests.read_exists(:'r'::uuid), 'the read goes on');

select tests.act_as(:'hana');
select tests.cap(:'hana', 'buddy_read', public.buddy_read(:'r')) as rd \gset
select tests.cap(:'hana', 'my_buddy_reads', public.my_buddy_reads()) is not null as _ \gset
reset role;
select ok(tests.card(:'rd'::jsonb, :'ola') is null and tests.card(:'rd'::jsonb, :'mae') is null and tests.card(:'rd'::jsonb, :'lu') is null,
  'Hana''s card list holds neither Ola, Mae nor Lu');
select ok(tests.card(:'rd'::jsonb, :'ivo') is not null and tests.card(:'rd'::jsonb, :'kim') is not null, 'but Ivo and Kim');

-- ------------------------------------------------------------------------- nothing about reading leaked

-- Every answer kept above, and every Realtime event the members' topics hold.
select tests.log_events();
select ok((select count(*) from tests.log where what like 'event %') >= 10, 'there were events to scan: posts, reactions, progress, joins');
select ok((select count(*) from tests.log where what not like 'event %') >= 15, 'and answers to scan');
select is((select coalesce(string_agg(what || ' ' || why, ', '), '') from tests.leaks()), '',
  'no payload shows a page, a percent, an entry id or a number of reading of another member');
select is((select count(*)::integer from tests.log l
            where l.what = 'buddy_read'
              and exists (select 1 from jsonb_array_elements(l.payload -> 'members') c
                           where c ->> 'id' <> l.viewer::text
                             and (c -> 'where' is not null and c -> 'where' <> 'null'::jsonb)
                             and not (c -> 'where' ->> 'kind' in ('not_set', 'section', 'end')))), 0,
  'the cards of the others hold a `where` of kind not_set, section or end, or none');
select is((select count(*)::integer from tests.log l
            where l.what = 'buddy_read'
              and exists (select 1 from jsonb_array_elements(l.payload -> 'members') c
                           where c ->> 'id' <> l.viewer::text
                             and jsonb_typeof(c -> 'where') = 'object'
                             and exists (select 1 from jsonb_object_keys(c -> 'where') k where k not in ('kind', 'section')))), 0,
  '`where` of another member holds only its kind and the Section''s number');

-- The scan finds what it looks for: a page, and another member's entry id, planted in the log.
insert into tests.log (viewer, what, payload) values
  (:'hana', 'planted key', '{"members": [{"page": 12}]}'),
  (:'hana', 'planted entry', jsonb_build_object('members', jsonb_build_array(jsonb_build_object('x', :'e_ivo'))));
select is((select array_agg(what order by what) from tests.leaks()), array['planted entry', 'planted key'],
  'the scan sees a planted page and a planted entry id of another member');
delete from tests.log where what like 'planted %';
select is((select count(*)::integer from tests.leaks()), 0, 'and nothing else');

select * from finish();
rollback;
