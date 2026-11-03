-- Buddy reads, D4: live updates over a private topic per member (docs/plans/buddy-read-shared.md
-- part 4.4, and 4.5 items 46 to 51):
--   supabase test db
--
-- Joining a private channel is a select on realtime.messages with realtime.topic() set to the
-- channel's topic, as the member (what the Realtime server does): the policy lets her join
-- member:<her id> and nothing else, and nobody may send on a member topic but the database. A sent
-- event is a row of realtime.messages. A post reaches each joined member and the author's own topic,
-- not a stranger, an invitee, a member who left or was removed, nor a member blocked either way with
-- the author. message.deleted carries no body, message.reaction carries emoji null when removed.
-- buddy_read.changed ({buddy_read_id}) on a join, a leave, a removal, a handover, a Section change, the
-- Sections and the status, once per member and statement; buddy.invitation to the invitee alone. No
-- payload carries a number about reading. A failing send does not fail the write.
--
-- realtime.send adds an `id` (the broadcast's own uuid) to a payload that has none: the key checks
-- below allow exactly that one key more.
-- A Section change is checked through set_buddy_hand; the trigger reads the row's read_through,
-- whatever wrote it (D2, below this migration, writes it from her reading progress).
-- (W2's tests/buddy-live.test.ts does the round trip through the Realtime server.)
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(71);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BUDDY-LIVE-1', 'buddy realtime test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-BUDDY-LIVE-1', 'name', p_name)), now(), now(), now());
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

-- A Catalogue Book's snapshot; the same title is the same Book (its Apple id follows from it).
create or replace function tests.snap(p_title text, p_work text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9800000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'openlibrary_work_key', p_work))
$$;

-- n parts "Section k" ending at k/n, then "The whole book".
create or replace function tests.secs(p_n integer, p_prefix text default 'Section')
returns jsonb language sql as $$
  select jsonb_agg(x order by o)
    from (select k as o, jsonb_build_object('kind', 'part', 'label', p_prefix || ' ' || k,
                                            'to_fraction', round(k::numeric / p_n, 4)) as x
            from generate_series(1, p_n) k
          union all
          select p_n + 1, jsonb_build_object('kind', 'end', 'label', 'The whole book', 'to_fraction', 1)) s
$$;

-- The keys of an object, sorted.
create or replace function tests.keys(p jsonb)
returns text[] language sql as $$ select array(select jsonb_object_keys(p) order by 1) $$;

-- A text message as the acting member; answers its id.
create or replace function tests.say(p_read uuid, p_section uuid, p_body text)
returns uuid language sql as $$
  select (public.post_buddy_message(p_read, p_section, gen_random_uuid(), 'text', p_body) ->> 'id')::uuid
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

-- What Realtime does when a member joins `p_topic`: the topic as a setting, then a select on
-- realtime.messages as her (the caller's role).
create or replace function tests.may_join(p_topic text)
returns boolean language plpgsql as $$
begin
  perform set_config('realtime.topic', p_topic, true);
  return exists (select 1 from realtime.messages where topic = p_topic and extension = 'broadcast');
end;
$$;

create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
  on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null
$$;
create or replace function tests.block(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;
create or replace function tests.section_ids(p_read uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.buddy_read_sections where buddy_read_id = p_read
$$;

-- The events this test looks at: realtime.messages rows on the topics of its members, sent after the
-- last tests.mark() (the rows of one transaction all share inserted_at, so a mark is a list of ids).
create table tests.members (id uuid primary key, name text not null);
create table tests.seen (id uuid primary key);

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

-- Who got an event about something since the mark: names, sorted, once per event sent (a member who
-- got it twice is listed twice).
create or replace function tests.who(p_event text, p_key text, p_value text)
returns text[] language sql security definer as $$
  select coalesce(array_agg(member order by member), '{}')
    from tests.fresh() where event = p_event and payload ->> p_key is not distinct from p_value
$$;

-- The one payload of an event about something since the mark, as a given member got it.
create or replace function tests.payload(p_member text, p_event text, p_key text, p_value text)
returns jsonb language sql security definer as $$
  select payload from tests.fresh()
   where member = p_member and event = p_event and payload ->> p_key = p_value
$$;

create or replace function tests.fresh_count()
returns integer language sql security definer as $$ select count(*)::integer from tests.fresh() $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------------- members and reads

select tests.member('hana@live.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@live.pgtap.test', 'Ivo') as ivo \gset
select tests.member('jo@live.pgtap.test', 'Jo') as jo \gset
select tests.member('kim@live.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@live.pgtap.test', 'Lu') as lu \gset
select tests.member('max@live.pgtap.test', 'Max') as max \gset
select tests.member('ned@live.pgtap.test', 'Ned') as ned \gset
select tests.member('ola@live.pgtap.test', 'Ola') as ola \gset
select tests.member('pat@live.pgtap.test', 'Pat') as pat \gset
select tests.member('quin@live.pgtap.test', 'Quin') as quin \gset
select tests.member('rae@live.pgtap.test', 'Rae') as rae \gset
select tests.member('sam@live.pgtap.test', 'Sam') as sam \gset
insert into tests.members (id, name) values
  (:'hana', 'hana'), (:'ivo', 'ivo'), (:'jo', 'jo'), (:'kim', 'kim'), (:'lu', 'lu'), (:'max', 'max'),
  (:'ned', 'ned'), (:'ola', 'ola'), (:'pat', 'pat'), (:'quin', 'quin'), (:'rae', 'rae'), (:'sam', 'sam');
select tests.follow(:'hana', :'max');
select tests.follow(:'hana', :'sam');

-- Read A: Hana hosts, four parts and the end, the link on; Ivo, Jo, Kim, Ned, Ola, Pat and Quin join
-- by the link; Max is invited and has not answered. Lu is in no read.
select tests.act_as(:'hana');
select (public.add_to_library(tests.snap('Live Dune'))).id as e_dune \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_dune'),
                                gen_random_uuid(), tests.secs(4), p_invite => array[:'max']::uuid[],
                                p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_a, (:'v'::jsonb ->> 'link_token') as t_a \gset
-- Read B: Ivo hosts, two parts; Rae joins (the host handover).
select tests.act_as(:'ivo');
select (public.add_to_library(tests.snap('Live Other'))).id as e_other \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_other'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_b, (:'v'::jsonb ->> 'link_token') as t_b \gset
-- Read C: Lu hosts alone (the last one out deletes it).
select tests.act_as(:'lu');
select (public.add_to_library(tests.snap('Live Alone'))).id as e_alone \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_alone'),
                                gen_random_uuid(), tests.secs(2)) as v \gset
select (:'v'::jsonb ->> 'id') as r_c \gset
reset role;

select tests.act_as(:'ivo');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'jo');   select public.join_buddy_read(:'t_a');
select tests.act_as(:'kim');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ned');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ola');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'pat');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'quin'); select public.join_buddy_read(:'t_a');
select tests.act_as(:'rae');  select public.join_buddy_read(:'t_b');
reset role;

select s[1] as a1 from (select tests.section_ids(:'r_a') s) x \gset

-- Pat blocks Jo, Jo blocks Quin: both directions of a block with Jo.
select tests.block(:'pat', :'jo');
select tests.block(:'jo', :'quin');

-- The keys no payload may carry (plan part 4.4, 5.5).
select array['read_through', 'hand_through', 'auto_through', 'entry_id', 'progress', 'page', 'percent',
             'fraction'] as numbers \gset

-- ------------------------------------------------------------------------- authorization (46, 47)

-- A row on two topics, so joining has something to see.
insert into realtime.messages (topic, extension, event, payload, private) values
  ('member:' || :'hana', 'broadcast', 'probe', '{}', true),
  ('member:' || :'ivo', 'broadcast', 'probe', '{}', true),
  ('member:' || :'hana', 'presence', 'probe', '{}', true);

select tests.act_as(:'hana');
select ok(tests.may_join('member:' || :'hana'), 'Hana may join her own topic (46)');
select ok(not tests.may_join('member:' || :'ivo'), 'not Ivo''s, a member of her read');
select ok(not tests.may_join('member:*'), 'nor a made-up topic');
select ok(not tests.may_join('buddy_read:' || :'r_a'), 'nor one named after her read');
select is((select count(*)::int from realtime.messages where topic = 'member:' || :'ivo'), 0,
  'with her own topic joined she still reads no row of Ivo''s');
select is((select count(*)::int from realtime.messages where extension = 'presence'), 0,
  'and only broadcast rows: no presence');
select is(tests.outcome(format($$ insert into realtime.messages (topic, extension, event, payload, private)
                                   values (%L, 'broadcast', 'message.new', '{}', true) $$, 'member:' || :'ivo')),
  '42501 new row violates row-level security policy for table "messages"',
  'she cannot send on Ivo''s topic (47)');
select is(tests.outcome(format($$ insert into realtime.messages (topic, extension, event, payload, private)
                                   values (%L, 'broadcast', 'message.new', '{}', true) $$, 'member:' || :'hana')),
  '42501 new row violates row-level security policy for table "messages"',
  'nor on her own: only the database sends');
select is(tests.outcome($$ select private.member_topic(gen_random_uuid()) $$),
  '42501 permission denied for schema private', 'the topic function is not hers to call by name');
select tests.act_anon();
select ok(not tests.may_join('member:' || :'hana'), 'a visitor without a session joins no member topic');
reset role;

select is(
  (select array_agg(cmd || ' ' || array_to_string(roles, ',') order by policyname)
     from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'buddy_member_topic_select'),
  array['SELECT authenticated'], 'the policy is a select for authenticated');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
  0, 'and realtime.messages has no policy that lets anyone write');
select ok(not has_schema_privilege('authenticated', 'private', 'usage')
          and not has_schema_privilege('anon', 'private', 'usage'),
  'schema private stays closed to the API roles');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('member_topic', 'buddy_recipients', 'buddy_send', 'buddy_changed', 'buddy_message_new',
                        'buddy_message_deleted', 'buddy_reaction_live', 'buddy_member_live', 'buddy_read_live',
                        'buddy_sections_live')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')
           or (p.proname <> 'member_topic' and has_function_privilege('authenticated', p.oid, 'execute')))),
  null::text[], 'nothing new is executable by anon or PUBLIC; authenticated only the topic, for the policy');
select is(
  (select count(*)::int from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('member_topic', 'buddy_recipients', 'buddy_send', 'buddy_changed', 'buddy_message_new',
                        'buddy_message_deleted', 'buddy_reaction_live', 'buddy_member_live', 'buddy_read_live',
                        'buddy_sections_live')
      and coalesce(array_to_string(p.proconfig, ','), '') not like 'search_path=%'),
  0, 'each pins its search path');

-- ------------------------------------------------------------------------- message.new (48, 51)

select tests.mark();
select tests.act_as(:'jo');
select tests.say(:'r_a', null, 'Who else cried at chapter three?') as m1 \gset
reset role;

select is(tests.who('message.new', 'id', :'m1'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola'],
  'Jo posts: each joined member gets it once, Jo''s own topic too; not Pat (blocked Jo), not Quin (Jo blocked her), not Max (invited), not Lu (48)');
select is(tests.keys(tests.payload('ivo', 'message.new', 'id', :'m1')),
  array['author_id', 'body', 'buddy_read_id', 'client_id', 'created_at', 'id', 'kind', 'media_height',
        'media_url', 'media_width', 'reply_to', 'section_id', 'spoiler'],
  'message.new is the row without deleted_*');
select is(tests.payload('ivo', 'message.new', 'id', :'m1') ->> 'body', 'Who else cried at chapter three?',
  'the whole row, words included: the veil is the app''s');

-- Ivo reads his own topic: Jo's message is there; with Hana's topic set he reads nothing of hers.
select tests.act_as(:'ivo');
select ok(tests.may_join('member:' || :'ivo')
          and exists (select 1 from realtime.messages where topic = 'member:' || :'ivo'
                         and event = 'message.new' and payload ->> 'id' = :'m1'),
  'Ivo reads the message on his own topic');
select ok(not tests.may_join('member:' || :'hana'), 'Hana''s topic, her copy of it included, stays shut to him');
reset role;

-- A Section thread: the same people.
select tests.mark();
select tests.act_as(:'hana');
select tests.say(:'r_a', :'a1', 'The end of part one!') as m2 \gset
reset role;
select is(tests.who('message.new', 'id', :'m2'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola', 'pat', 'quin'],
  'Hana posts in a Section: every joined member, those blocked with Jo too (no block with Hana)');

-- ------------------------------------------------------------------------- message.reaction

select tests.mark();
select tests.act_as(:'hana');
select public.react_to_buddy_message(:'m1', '❤️');
reset role;
select is(tests.who('message.reaction', 'message_id', :'m1'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola'],
  'Hana reacts to Jo''s message: the members who see it, and Hana''s own topic');
select is(tests.payload('jo', 'message.reaction', 'message_id', :'m1') - 'id',
  jsonb_build_object('message_id', :'m1', 'buddy_read_id', :'r_a', 'member_id', :'hana', 'emoji', '❤️'),
  'message.reaction is {message_id, buddy_read_id, member_id, emoji} (and realtime.send''s id)');

select tests.mark();
select tests.act_as(:'hana');
select public.react_to_buddy_message(:'m1', '🔥');
reset role;
select is(tests.payload('jo', 'message.reaction', 'message_id', :'m1') ->> 'emoji', '🔥',
  'another emoji: the new one');

select tests.mark();
select tests.act_as(:'hana');
select public.react_to_buddy_message(:'m1', null);
reset role;
select ok((tests.payload('jo', 'message.reaction', 'message_id', :'m1') ? 'emoji')
          and tests.payload('jo', 'message.reaction', 'message_id', :'m1') -> 'emoji' = 'null'::jsonb,
  'removed: emoji is null');

-- Ivo reacts to Hana's Section message; Kim blocks Ivo first: Kim does not hear of Ivo's reaction.
select tests.block(:'kim', :'ivo');
select tests.mark();
select tests.act_as(:'ivo');
select public.react_to_buddy_message(:'m2', '😮');
reset role;
select is(tests.who('message.reaction', 'message_id', :'m2'),
  array['hana', 'ivo', 'jo', 'ned', 'ola', 'pat', 'quin'],
  'a reaction does not reach a member blocked with the one who reacted');
delete from public.blocks where blocker_id = :'kim' and blocked_id = :'ivo';

-- ------------------------------------------------------------------------- message.deleted

select tests.act_as(:'ivo');
select public.react_to_buddy_message(:'m1', '😂');
reset role;
select tests.mark();
select tests.act_as(:'jo');
select public.delete_buddy_message(:'m1');
reset role;
select is(tests.who('message.deleted', 'id', :'m1'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola'],
  'Jo deletes her message: the same members hear of it');
select is(tests.keys(tests.payload('kim', 'message.deleted', 'id', :'m1')),
  array['buddy_read_id', 'id', 'section_id'], 'message.deleted is {id, buddy_read_id, section_id}: no body');
select is(tests.payload('kim', 'message.reaction', 'message_id', :'m1') -> 'emoji', 'null'::jsonb,
  'the tombstone clears Ivo''s reaction: emoji null');
select tests.mark();
select tests.act_as(:'jo');
select public.delete_buddy_message(:'m1');
reset role;
select is(tests.fresh_count(), 0, 'deleting it again sends nothing');

-- ------------------------------------------------------------------------- buddy_read.changed (50)

-- A Section change by hand.
select tests.mark();
select tests.act_as(:'kim');
select public.set_buddy_hand(:'r_a', 2);
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola', 'pat', 'quin'],
  'Kim sets her Section by hand: buddy_read.changed to every joined member, once');
select is(tests.keys(tests.payload('ivo', 'buddy_read.changed', 'buddy_read_id', :'r_a') - 'id'),
  array['buddy_read_id'], 'its payload is {buddy_read_id} (and realtime.send''s id), no number (50)');
select isnt(tests.payload('ivo', 'buddy_read.changed', 'buddy_read_id', :'r_a') ->> 'id', :'r_a',
  'the id realtime.send adds is the broadcast''s own');

select tests.mark();
select tests.act_as(:'kim');
select public.set_buddy_hand(:'r_a', 2);
reset role;
select is(tests.fresh_count(), 0, 'the same Section again: nothing');

select tests.mark();
select tests.act_as(:'jo');
select public.set_buddy_hand(:'r_a', 1);
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'ned', 'ola'],
  'Jo''s Section changes: not to Pat or Quin, blocked with her (no hint of her reading)');

select tests.mark();
select tests.act_as(:'kim');
select public.mark_buddy_read(:'r_a', null, null);
select public.mark_buddy_read(:'r_a', :'a1', null);
reset role;
select is(tests.fresh_count(), 0, 'reading a thread (the cursors) sends nothing');

-- An invitation, and its answer.
select tests.mark();
select tests.act_as(:'hana');
select public.invite_to_buddy_read(:'r_a', array[:'sam']::uuid[]);
reset role;
select is(tests.who('buddy.invitation', 'buddy_read_id', :'r_a'), array['sam'],
  'Hana invites Sam: buddy.invitation to Sam alone');
select is(tests.keys(tests.payload('sam', 'buddy.invitation', 'buddy_read_id', :'r_a') - 'id'),
  array['buddy_read_id'], 'as {buddy_read_id}');
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'), '{}'::text[],
  'and nothing to the members: a pending invitation is not a member');

select tests.mark();
select tests.act_as(:'sam');
select public.answer_buddy_invite(:'r_a', false);
reset role;
select is(tests.who('buddy.invitation', 'buddy_read_id', :'r_a'), array['sam'],
  'Sam declines: her own devices hear the invitation is gone, nobody else hears anything');
select is(tests.fresh_count(), 1, 'and that is all');

select tests.mark();
select tests.act_as(:'max');
select public.answer_buddy_invite(:'r_a', true);
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'ned', 'ola', 'pat', 'quin'],
  'Max accepts: every joined member, Max too');

-- Joining by the link.
select tests.mark();
select tests.act_as(:'sam');
select public.join_buddy_read(:'t_a');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'ned', 'ola', 'pat', 'quin', 'sam'],
  'Sam joins by the link: every joined member, Sam too');
select tests.mark();
select tests.act_as(:'sam');
select public.join_buddy_read(:'t_a');
reset role;
select is(tests.fresh_count(), 0, 'joining again: nothing');

-- Leaving and being removed (51).
select tests.mark();
select tests.act_as(:'ola');
select public.leave_buddy_read(:'r_a');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'ned', 'ola', 'pat', 'quin', 'sam'],
  'Ola leaves: the members, and Ola''s own devices');

select tests.mark();
select tests.act_as(:'hana');
select public.remove_from_buddy_read(:'r_a', :'ned');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'ned', 'pat', 'quin', 'sam'],
  'Hana removes Ned: the members, and Ned (his screen closes)');

select tests.mark();
select tests.act_as(:'kim');
select tests.say(:'r_a', null, 'Where did Ola go?') as m3 \gset
reset role;
select is(tests.who('message.new', 'id', :'m3'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'pat', 'quin', 'sam'],
  'a post after that reaches neither Ola who left nor Ned who was removed (51); Max and Sam now');

-- The host leaves: the handover in the same statement, one event each.
select tests.mark();
select tests.act_as(:'ivo');
select public.leave_buddy_read(:'r_b');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_b'), array['ivo', 'rae'],
  'Ivo, the host of read B, leaves: Rae becomes host and hears of it once, not once per row');

-- The last one out: the read is deleted, nothing raises, nothing is sent about it.
select tests.mark();
select tests.act_as(:'lu');
select is(tests.outcome(format('select public.leave_buddy_read(%L)', :'r_c')), 'ok',
  'Lu, alone in read C, leaves: the read goes');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_c'), '{}'::text[], 'and no event about it');

-- The Sections: a rename and a new division (no Section thread may have a message: read B has none).
select tests.mark();
select tests.act_as(:'rae');
select public.set_buddy_sections(:'r_b', tests.secs(2, 'Part'));
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_b'), array['rae'],
  'Rae renames the Sections: one event, not one per Section');
select tests.act_as(:'jo');
select public.join_buddy_read(:'t_b');
select public.set_buddy_hand(:'r_b', 2);
reset role;
select tests.mark();
select tests.act_as(:'rae');
select public.set_buddy_sections(:'r_b', tests.secs(5));
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_b'), array['jo', 'rae'],
  'a new division: one event each, whatever the rows it deleted and wrote');

-- The status.
select tests.mark();
select tests.act_as(:'hana');
select public.finish_buddy_read(:'r_a');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'pat', 'quin', 'sam'],
  'Hana finishes read A: every joined member, blocked pairs too (not about one member)');
select tests.mark();
select tests.act_as(:'hana');
select public.finish_buddy_read(:'r_a');
reset role;
select is(tests.fresh_count(), 0, 'finishing it again: nothing');
select tests.mark();
select tests.act_as(:'hana');
select public.archive_buddy_read(:'r_a');
reset role;
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'max', 'pat', 'quin', 'sam'],
  'archiving it: the same');

-- ------------------------------------------------------------------------- an account deleted

-- Kim reacted in read B? No: Kim reacts in read A is not possible now (archived). Max reacts first in a
-- live read: B. Max joins B, reacts to Rae's message, then his account goes.
select tests.act_as(:'rae');
select tests.say(:'r_b', null, 'Welcome, all') as m4 \gset
select tests.act_as(:'max');
select public.join_buddy_read(:'t_b');
select public.react_to_buddy_message(:'m4', '📚');
select tests.say(:'r_b', null, 'Thanks!') as m5 \gset
reset role;
select tests.mark();
select is(tests.outcome(format('delete from auth.users where id = %L', :'max')), 'ok',
  'Max''s account is deleted: his rows go, nothing raises');
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_b'), array['jo', 'rae'],
  'read B''s members hear once that he is gone');
select is(tests.who('buddy_read.changed', 'buddy_read_id', :'r_a'),
  array['hana', 'ivo', 'jo', 'kim', 'pat', 'quin', 'sam'], 'and so do read A''s');
select is(tests.who('message.reaction', 'message_id', :'m4'), '{}'::text[],
  'his reaction going with him is not an event of its own');
select is((select count(*)::int from tests.fresh() where member = 'max'), 0, 'nothing is sent to his topic');

-- ------------------------------------------------------------------------- no numbers, ever (49)

select is(
  (select count(*)::int from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
    where m.payload ?| :'numbers'::text[]),
  0, 'no payload of any event in this test has read_through, hand_through, auto_through, entry_id, progress, page, percent or fraction (49)');
select is(
  array(select distinct m.event collate "C" from realtime.messages m
           join tests.members t on m.topic = 'member:' || t.id where m.event <> 'probe' order by 1),
  array['buddy.invitation', 'buddy_read.changed', 'message.deleted', 'message.new', 'message.reaction'],
  'and those are all the events there are');
select is(
  (select count(*)::int from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
    where m.event not in ('message.new', 'probe')
      and exists (select 1 from jsonb_each(m.payload) e where jsonb_typeof(e.value) = 'number')),
  0, 'no number at all outside message.new (whose numbers are a GIF''s size)');
select is(
  (select count(*)::int from realtime.messages m join tests.members t on m.topic = 'member:' || t.id
    where m.event <> 'probe' and not m.private),
  0, 'every event is sent private');

-- ------------------------------------------------------------------------- a failing send

-- The topic function raises (inside the fan-out's guard): the post goes through, nothing is sent.
savepoint failing_topic;
create or replace function private.member_topic(p_member uuid)
returns text language plpgsql immutable set search_path = pg_catalog as $$
begin
  raise exception 'topic down';
end;
$$;
select tests.mark();
select tests.act_as(:'rae');
select tests.outcome($$ select tests.say('$$ || :'r_b' || $$', null, 'Still here') $$) as fail_topic_outcome \gset
reset role;
select count(*) as fail_topic_written from public.buddy_messages
 where buddy_read_id = :'r_b' and body = 'Still here' \gset
select tests.fresh_count() as fail_topic_sent \gset
rollback to savepoint failing_topic;
select is(:'fail_topic_outcome'::text, 'ok', 'a send that raises (the topic) does not fail post_buddy_message');
select is(:'fail_topic_written'::int, 1, 'the message is written');
select is(:'fail_topic_sent'::int, 0, 'and nothing was sent');

-- realtime.messages refuses the row (inside realtime.send's own guard): the same.
savepoint failing_insert;
create function tests.refuse() returns trigger language plpgsql as $$ begin raise exception 'realtime down'; end $$;
create trigger tests_refuse before insert on realtime.messages for each row execute function tests.refuse();
select tests.mark();
select tests.act_as(:'rae');
select tests.outcome($$ select tests.say('$$ || :'r_b' || $$', null, 'Still here') $$) as fail_insert_outcome \gset
select tests.outcome($$ select public.set_buddy_hand('$$ || :'r_b' || $$', 1) $$) as fail_hand_outcome \gset
reset role;
select count(*) as fail_insert_written from public.buddy_messages
 where buddy_read_id = :'r_b' and body = 'Still here' \gset
select tests.fresh_count() as fail_insert_sent \gset
rollback to savepoint failing_insert;
select is(:'fail_insert_outcome'::text, 'ok', 'realtime.messages refusing the row does not fail post_buddy_message');
select is(:'fail_hand_outcome'::text, 'ok', 'nor set_buddy_hand');
select is(:'fail_insert_written'::int, 1, 'the message is written');
select is(:'fail_insert_sent'::int, 0, 'and nothing was sent');

select * from finish();
rollback;
