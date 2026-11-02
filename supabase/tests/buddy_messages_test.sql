-- Buddy reads, D3: messages, reactions, delete, reports, read cursors (docs/plans/buddy-read-shared.md
-- part 4.5, items 1 to 32, and the D1 functions D3 completes):
--   supabase test db
--
-- A joined member posts text or a KLIPY GIF in the room or in a Section of her read; a retry with the
-- same client id answers the first row; times only go forward within a read; 30 messages a minute and
-- 600 a day. The read's lock is taken after her member lock and the gate is checked again after it (the
-- removal race). Answers stay in their thread, never to a tombstone; an archived read takes no new
-- message or reaction, a finished one does; spoilers only in a Section. Pages go by before/after; a
-- block hides each one's messages and reactions from the other, both ways. One reaction per member; a
-- tombstone keeps nothing it said; cursors only move forward; a report is one feedback row for the
-- owner, under the feedback limiter. buddy_read and my_buddy_reads count for real, and the list never
-- counts a Section she may not open yet. An account deleted takes her messages and reactions with it.
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(171);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BUDDY-MSG-1', 'buddy messages test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-BUDDY-MSG-1', 'name', p_name)), now(), now(), now());
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

-- Signed in as a role, with no member: what a broken token looks like.
create or replace function tests.act_nobody()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  execute 'set local role authenticated';
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
create or replace function tests.say(p_read uuid, p_section uuid, p_body text, p_reply_to uuid default null)
returns uuid language sql as $$
  select (public.post_buddy_message(p_read, p_section, gen_random_uuid(), 'text', p_body, p_reply_to) ->> 'id')::uuid
$$;

-- The ids of a page, in its order.
create or replace function tests.ids(p_page jsonb)
returns uuid[] language sql as $$
  select coalesce(array_agg((m ->> 'id')::uuid order by o), '{}') from jsonb_array_elements(p_page) with ordinality x(m, o)
$$;

-- A message in a page.
create or replace function tests.in_page(p_page jsonb, p_message uuid)
returns jsonb language sql as $$
  select m from jsonb_array_elements(p_page) m where m ->> 'id' = p_message::text
$$;

-- A Section of buddy_read()'s list, by position.
create or replace function tests.sec(p_read jsonb, p_position integer)
returns jsonb language sql as $$
  select s from jsonb_array_elements(p_read -> 'sections') s where (s ->> 'position')::int = p_position
$$;

-- Her unread number for a read in my_buddy_reads().
create or replace function tests.unread_in_list(p_read uuid)
returns integer language sql as $$
  select (r ->> 'unread')::int from jsonb_array_elements(public.my_buddy_reads() -> 'reads') r where r ->> 'id' = p_read::text
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

-- Past RLS, for the assertions.
create or replace function tests.msg(p_id uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.buddy_messages m where m.id = p_id
$$;
create or replace function tests.msgs_by(p_read uuid, p_author uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where buddy_read_id = p_read and author_id = p_author
$$;
create or replace function tests.msgs_in(p_read uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where buddy_read_id = p_read
$$;
create or replace function tests.with_client(p_author uuid, p_client uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where author_id = p_author and client_id = p_client
$$;
create or replace function tests.reactions_on(p_message uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_reactions where message_id = p_message
$$;
create or replace function tests.reaction_of(p_message uuid, p_member uuid)
returns text language sql security definer as $$
  select emoji from public.buddy_reactions where message_id = p_message and member_id = p_member
$$;
create or replace function tests.reactions_by(p_member uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_reactions where member_id = p_member
$$;
create or replace function tests.cursor(p_section uuid, p_member uuid)
returns timestamptz language sql security definer as $$
  select last_read_at from public.buddy_section_cursors where section_id = p_section and member_id = p_member
$$;
create or replace function tests.cursors_of(p_member uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_section_cursors where member_id = p_member
$$;
create or replace function tests.room_cursor(p_read uuid, p_member uuid)
returns timestamptz language sql security definer as $$
  select last_read_at from public.buddy_read_members where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.section_ids(p_read uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.buddy_read_sections where buddy_read_id = p_read
$$;
create or replace function tests.block(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;
create or replace function tests.set_hand(p_read uuid, p_member uuid, p_hand smallint)
returns void language sql security definer as $$
  update public.buddy_read_members set hand_through = p_hand where buddy_read_id = p_read and member_id = p_member
$$;
-- n messages of a member in a read's room at a given time, past the API (the limits).
create or replace function tests.fill_messages(p_read uuid, p_author uuid, p_n integer, p_at timestamptz)
returns void language sql security definer as $$
  insert into public.buddy_messages (buddy_read_id, author_id, client_id, kind, body, created_at)
  select p_read, p_author, gen_random_uuid(), 'text', 'filler ' || k, p_at from generate_series(1, p_n) k
$$;
create or replace function tests.fill_calls(p_member uuid, p_kind text, p_n integer)
returns void language sql security definer as $$
  insert into private.buddy_calls (member_id, kind) select p_member, p_kind from generate_series(1, p_n)
$$;
create or replace function tests.clear_calls(p_member uuid)
returns void language sql security definer as $$
  delete from private.buddy_calls where member_id = p_member
$$;
-- A raw insert past the API: what the table's checks say (23514 or ok).
create or replace function tests.raw_insert(p_values text)
returns text language plpgsql security definer as $$
begin
  execute 'insert into public.buddy_messages (buddy_read_id, section_id, author_id, client_id, kind, body, '
          'media_url, media_width, media_height, spoiler, deleted_at) values ' || p_values;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create or replace function tests.reports_of(p_member uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.feedback where member_id = p_member and kind = 'report'
$$;
create or replace function tests.last_report(p_member uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(f) from public.feedback f where member_id = p_member and kind = 'report'
   order by created_at desc, id desc limit 1
$$;
create or replace function tests.fill_feedback(p_member uuid, p_n integer)
returns void language sql security definer as $$
  insert into public.feedback (member_id, kind, body) select p_member, 'other', 'An earlier message ' || k
    from generate_series(1, p_n) k
$$;
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;
create or replace function tests.newest_but(p_read uuid, p_id uuid)
returns timestamptz language sql security definer as $$
  select max(created_at) from public.buddy_messages where buddy_read_id = p_read and id <> p_id
$$;
create or replace function tests.live_in_room(p_read uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where buddy_read_id = p_read and section_id is null and deleted_at is null
$$;
create or replace function tests.read_gone(p_read uuid)
returns boolean language sql security definer as $$
  select not exists (select 1 from public.buddy_reads where id = p_read)
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------------- members and reads

select tests.member('hana@msg.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@msg.pgtap.test', 'Ivo') as ivo \gset
select tests.member('jo@msg.pgtap.test', 'Jo') as jo \gset
select tests.member('kim@msg.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@msg.pgtap.test', 'Lu') as lu \gset
select tests.member('max@msg.pgtap.test', 'Max') as max \gset
select tests.member('ned@msg.pgtap.test', 'Ned') as ned \gset
select tests.member('ola@msg.pgtap.test', 'Ola') as ola \gset
select tests.member('pat@msg.pgtap.test', 'Pat') as pat \gset
select tests.member('quin@msg.pgtap.test', 'Quin') as quin \gset
select tests.member('rae@msg.pgtap.test', 'Rae') as rae \gset
select tests.member('sam@msg.pgtap.test', 'Sam') as sam \gset
select tests.member('tom@msg.pgtap.test', 'Tom') as tom \gset

-- Read A: Hana hosts, four parts and the end; Ivo, Jo, Kim, Max, Ned, Ola and Pat join by the link.
select tests.act_as(:'hana');
select (public.add_to_library(tests.snap('Messages Dune'))).id as e_dune \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_dune'),
                                gen_random_uuid(), tests.secs(4), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_a, (:'v'::jsonb ->> 'link_token') as t_a \gset
-- Read B: Ivo hosts, two parts; Hana joins.
select tests.act_as(:'ivo');
select (public.add_to_library(tests.snap('Messages Other'))).id as e_other \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_other'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_b, (:'v'::jsonb ->> 'link_token') as t_b \gset
-- Read C: Sam hosts, two parts; Rae and Quin join (the limits).
select tests.act_as(:'sam');
select (public.add_to_library(tests.snap('Messages Sam'))).id as e_sam \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_sam'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_c, (:'v'::jsonb ->> 'link_token') as t_c \gset
reset role;

select tests.act_as(:'ivo');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'jo');   select public.join_buddy_read(:'t_a');
select tests.act_as(:'kim');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'max');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ned');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ola');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'pat');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'hana'); select public.join_buddy_read(:'t_b');
select tests.act_as(:'rae');  select public.join_buddy_read(:'t_c');
select tests.act_as(:'quin'); select public.join_buddy_read(:'t_c');
reset role;

select s[1] as a1, s[2] as a2, s[3] as a3, s[4] as a4, s[5] as a_end from (select tests.section_ids(:'r_a') s) x \gset
select s[1] as b1, s[3] as b_end from (select tests.section_ids(:'r_b') s) x \gset
select s[1] as c1 from (select tests.section_ids(:'r_c') s) x \gset
select 'https://static.klipy.com/ii/d7aec6f6f171607374b2065c836f92f4/96/d3/0VJvNcfA.webp' as gif \gset

-- ------------------------------------------------------------------------- grants and RLS

select is(
  (select count(*)::int from unnest(array[
      'public.post_buddy_message(uuid, uuid, uuid, text, text, uuid, boolean, jsonb)',
      'public.buddy_read_messages(uuid, uuid, timestamptz, timestamptz, integer)',
      'public.react_to_buddy_message(uuid, text)', 'public.delete_buddy_message(uuid)',
      'public.mark_buddy_read(uuid, uuid, timestamptz)', 'public.report_buddy_message(uuid, text, text)'
    ]) f where has_function_privilege('anon', f::regprocedure, 'execute')
            or has_function_privilege('public', f::regprocedure, 'execute')
            or not has_function_privilege('authenticated', f::regprocedure, 'execute')
            or not (select prosecdef from pg_proc where oid = f::regprocedure)
            or (select proconfig from pg_proc where oid = f::regprocedure)
                   is distinct from array['search_path=pg_catalog, public, private']),
  0, 'the six functions: members only, security definer, search path pinned');
select is(
  (select count(*)::int from unnest(array[
      'private.buddy_rate_window(uuid, text, integer, interval)', 'private.buddy_hidden(uuid, uuid)',
      'private.buddy_reactions_json(uuid, uuid)', 'private.buddy_message_json(uuid, public.buddy_messages)',
      'private.buddy_message_for(uuid, uuid)', 'private.buddy_counts(uuid, uuid)', 'private.buddy_unread(uuid, uuid)',
      'private.buddy_cursors_gone()'
    ]) f, unnest(array['public', 'anon', 'authenticated']) r
    where has_function_privilege(r, f::regprocedure, 'execute')),
  0, 'no API role can call a helper');
select is(
  (select count(*)::int from unnest(array['public.buddy_messages', 'public.buddy_reactions', 'public.buddy_section_cursors']) t,
          unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
    where has_table_privilege(r, t, p)),
  0, 'no new table is granted to anon or authenticated');
select is(
  (select count(*)::int from pg_class
    where oid in ('public.buddy_messages'::regclass, 'public.buddy_reactions'::regclass, 'public.buddy_section_cursors'::regclass)
      and relrowsecurity),
  3, 'RLS is on for the three tables');
select is(
  (select count(*)::int from pg_policies where tablename in ('buddy_messages', 'buddy_reactions', 'buddy_section_cursors')),
  0, 'and none has a policy');
select is(
  (select count(*)::int
     from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in ('public.buddy_messages'::regclass, 'public.buddy_reactions'::regclass,
                         'public.buddy_section_cursors'::regclass)
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])),
  0, 'every foreign key leads an index');

select tests.act_as(:'hana');
select throws_ok($$ select * from public.buddy_messages $$, '42501', null, 'a member cannot select buddy_messages');
select throws_ok($$ select * from public.buddy_reactions $$, '42501', null, 'nor buddy_reactions');
select throws_ok($$ select * from public.buddy_section_cursors $$, '42501', null, 'nor buddy_section_cursors');
select tests.act_anon();
select throws_ok(format($$ select public.buddy_read_messages('%s') $$, :'r_a'), '42501', null, 'signed out, nothing can be called');
select throws_ok(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'text', 'hi') $$, :'r_a'),
  '42501', null, 'nor a post');
select tests.act_nobody();
select throws_ok(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'text', 'hi') $$, :'r_a'),
  '42501', 'not_signed_in', 'a token with no member is not_signed_in');

-- ------------------------------------------------------------------------- post (1, 2, 3)

select tests.act_as(:'hana');
select gen_random_uuid() as c1 \gset
select public.post_buddy_message(:'r_a', null, :'c1', 'text', 'Welcome, everyone!') as v \gset
select (:'v'::jsonb ->> 'id') as m1 \gset
select is(tests.keys(:'v'),
  array['author', 'body', 'client_id', 'created_at', 'deleted_at', 'id', 'kind', 'media_height', 'media_url', 'media_width',
        'reactions', 'reply_to', 'section_id', 'spoiler'],
  'a post answers the message');
select ok(:'v'::jsonb -> 'author' = jsonb_build_object('id', :'hana', 'name', 'Hana') and :'v'::jsonb ->> 'kind' = 'text'
          and :'v'::jsonb -> 'section_id' = 'null'::jsonb and :'v'::jsonb ->> 'body' = 'Welcome, everyone!'
          and :'v'::jsonb -> 'reactions' = '[]'::jsonb,
  'in the room, as hers, with its text');
select is(public.post_buddy_message(:'r_a', null, :'c1', 'text', 'Welcome, everyone!') ->> 'id', :'m1',
  'the same client id again answers the first message (1)');
select is(tests.with_client(:'hana', :'c1'), 1, 'and inserts none');
select throws_ok(format($$ select public.post_buddy_message('%s', null, '%s', 'text', 'x') $$, :'r_b', :'c1'),
  'PT409', 'message_client_id_reused', 'the same client id in another read is refused (2)');
select throws_ok(format($$ select public.post_buddy_message('%s', '%s', '%s', 'text', 'x') $$, :'r_a', :'a1', :'c1'),
  'PT409', 'message_client_id_reused', 'in another thread of the read');
select throws_ok(format($$ select public.post_buddy_message('%s', null, '%s', 'gif', '', p_gif => '{"url": "%s", "width": 1, "height": 1}') $$,
                        :'r_a', :'c1', :'gif'),
  'PT409', 'message_client_id_reused', 'or as another kind');
select throws_ok(format($$ select public.post_buddy_message('%s', null, null, 'text', 'x') $$, :'r_a'),
  '22023', 'message_client_id_required', 'no client id: refused (3)');
select is(
  (select count(*)::int from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and ((l.classid::bigint << 32) | l.objid::bigint) in (hashtextextended('buddy:' || :'hana', 0),
                                                             hashtextextended('buddy_read:' || :'r_a', 0))),
  2, 'a post took her member lock and the read''s lock');

-- ------------------------------------------------------------------------- order (4)

select tests.say(:'r_a', null, 'Second') as m2 \gset
select tests.say(:'r_a', null, 'Third') as m3 \gset
select ok((tests.msg(:'m1') ->> 'created_at')::timestamptz < (tests.msg(:'m2') ->> 'created_at')::timestamptz
          and (tests.msg(:'m2') ->> 'created_at')::timestamptz < (tests.msg(:'m3') ->> 'created_at')::timestamptz,
  'three posts in one transaction have distinct, increasing times (4)');
reset role;
-- A message of read B whose time is ahead of the clock (another server's clock, a burst): the next one goes after it.
select tests.fill_messages(:'r_b', :'ivo', 1, clock_timestamp() + interval '1 hour');
select tests.act_as(:'hana');
select tests.say(:'r_b', null, 'After the one ahead') as mb1 \gset
select is((tests.msg(:'mb1') ->> 'created_at')::timestamptz,
  tests.newest_but(:'r_b', :'mb1') + interval '1 microsecond',
  'a post never sorts before an earlier message: one microsecond after the newest of the read');

-- ------------------------------------------------------------------------- rate limits (5)

select tests.fill_messages(:'r_c', :'rae', 29, clock_timestamp() - interval '10 seconds');
select tests.act_as(:'rae');
select lives_ok(format($$ select tests.say('%s', null, 'thirtieth') $$, :'r_c'), 'the 30th message within a minute is allowed (5)');
select throws_ok(format($$ select tests.say('%s', null, 'thirty-first') $$, :'r_c'),
  'PT429', 'message_rate_limited', 'the 31st is refused');
select tests.fill_messages(:'r_c', :'quin', 599, now() - interval '2 hours');
select tests.act_as(:'quin');
select lives_ok(format($$ select tests.say('%s', null, 'six hundredth') $$, :'r_c'), 'the 600th of a day is allowed');
select throws_ok(format($$ select tests.say('%s', null, 'one more') $$, :'r_c'),
  'PT429', 'message_rate_limited', 'the 601st is refused');

-- ------------------------------------------------------------------------- the removal race (6)

-- pgTAP has one session, so the race is shown in two parts. First: the read's lock is asked for while
-- her member lock is already held (the order 1 then 2). Then: her member row is deleted at the moment
-- she gets the read's lock, after she passed the first check, as the host's removal committing while
-- she waited for that lock would; the post is refused, not written. A real two-session interleaving is
-- not run here.
reset role;
create table tests.lock_log (member_held boolean);
create or replace function private.buddy_lock_read(p_read uuid)
returns void
language plpgsql
set search_path = pg_catalog
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy_read:' || p_read::text, 0));
  if current_setting('tests.race', true) = 'order' then
    perform set_config('tests.race', '', true);
    insert into tests.lock_log
    select exists (select 1 from pg_locks l
                    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
                      and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('buddy:' || auth.uid()::text, 0));
  elsif current_setting('tests.race', true) = 'remove' then
    perform set_config('tests.race', '', true);
    delete from public.buddy_read_members where buddy_read_id = p_read and member_id = auth.uid();
  end if;
end;
$$;
select tests.act_as(:'max');
select set_config('tests.race', 'order', true);
select tests.say(:'r_a', null, 'Max is here') as m_max \gset
reset role;
select is((select array_agg(member_held) from tests.lock_log), array[true],
  'the post asked for the read''s lock while holding her member lock (6: the order 1 then 2)');
select tests.act_as(:'max');
select set_config('tests.race', 'remove', true);
select throws_ok(format($$ select tests.say('%s', null, 'written after the removal?') $$, :'r_a'),
  'PT404', 'not_found', 'a poster removed while she waited for the read''s lock is refused after it');
select is(tests.msgs_by(:'r_a', :'max'), 1, 'and nothing of hers was written but her first message');
reset role;
create or replace function private.buddy_lock_read(p_read uuid)
returns void
language sql
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('buddy_read:' || p_read::text, 0))
$$;
select tests.act_as(:'hana');
select public.remove_from_buddy_read(:'r_a', :'max');
select tests.act_as(:'max');
select throws_ok(format($$ select tests.say('%s', null, 'still here?') $$, :'r_a'),
  'PT404', 'not_found', 'a removed member is refused (12)');

-- ------------------------------------------------------------------------- threads, answers, kinds (7, 8, 10, 11)

select tests.act_as(:'hana');
select throws_ok(format($$ select tests.say('%s', '%s', 'wrong read') $$, :'r_a', :'b1'),
  '22023', 'buddy_section_invalid', 'a Section of another read is refused (7)');
select throws_ok(format($$ select tests.say('%s', '%s', 'no such Section') $$, :'r_a', gen_random_uuid()),
  '22023', 'buddy_section_invalid', 'and one that is not there');
select tests.say(:'r_a', :'a1', 'Chapter one is slow') as s1 \gset
select is(tests.msg(:'s1') ->> 'section_id', :'a1', 'a post in a Section''s thread');
select tests.act_as(:'ivo');
select tests.say(:'r_a', :'a1', 'It picks up', :'s1') as s1r \gset
select is(tests.msg(:'s1r') ->> 'reply_to', :'s1', 'an answer in the same thread (8)');
select throws_ok(format($$ select tests.say('%s', null, 'answer in the room', '%s') $$, :'r_a', :'s1'),
  '22023', 'message_reply_unavailable', 'an answer from another thread is refused');
select throws_ok(format($$ select tests.say('%s', '%s', 'answer across Sections', '%s') $$, :'r_a', :'a2', :'s1'),
  '22023', 'message_reply_unavailable', 'also from another Section');
select throws_ok(format($$ select tests.say('%s', null, 'answer across reads', '%s') $$, :'r_a', :'mb1'),
  '22023', 'message_reply_unavailable', 'and from another read');
select throws_ok(format($$ select tests.say('%s', null, 'answer nothing', '%s') $$, :'r_a', gen_random_uuid()),
  '22023', 'message_reply_unavailable', 'and to a message that is not there');

select tests.act_as(:'hana');
select throws_ok(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'text', 'Careful', p_spoiler => true) $$, :'r_a'),
  '22023', 'message_spoiler_unavailable', 'a spoiler in the room is refused (11)');
select public.post_buddy_message(:'r_a', :'a2', gen_random_uuid(), 'text', 'He dies!', p_spoiler => true) ->> 'id' as s2 \gset
select is(tests.msg(:'s2') ->> 'spoiler', 'true', 'a spoiler in a Section is kept');
select throws_ok(format($$ select tests.say('%s', null, '   ') $$, :'r_a'),
  '22023', 'message_body_invalid', 'a text of blanks is refused');
select throws_ok(format($$ select tests.say('%s', null, repeat('x', 2001)) $$, :'r_a'),
  '22023', 'message_body_invalid', 'and one over 2000 characters');
select throws_ok(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'image', '') $$, :'r_a'),
  '22023', 'message_kind_invalid', 'a photo is not a kind yet');

select public.post_buddy_message(:'r_a', null, gen_random_uuid(), 'gif', null,
         p_gif => jsonb_build_object('url', :'gif', 'width', 498, 'height', 278)) as v \gset
select (:'v'::jsonb ->> 'id') as g1 \gset
select ok(:'v'::jsonb ->> 'kind' = 'gif' and :'v'::jsonb ->> 'media_url' = :'gif'
          and (:'v'::jsonb ->> 'media_width')::int = 498 and (:'v'::jsonb ->> 'media_height')::int = 278,
  'a GIF from KLIPY, with its size (10)');
select is(
  array(select tests.outcome(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'gif', '',
                                         p_gif => jsonb_build_object('url', %L, 'width', 498, 'height', 278)) $$, :'r_a', u))
          from unnest(array['https://media.giphy.com/media/abc/200w.webp', 'https://static.klipy.com.evil.example/x.webp',
                            'http://static.klipy.com/x.webp', 'https://evil.example/static.klipy.com/x.webp',
                            'https://static.klipy.com/x y.webp', 'https://static.klipy.com/' || repeat('a', 480)]) u),
  array_fill('22023 message_gif_invalid'::text, array[6]),
  'a GIF off KLIPY''s hosts, over plain http, with a space or over 500 characters is refused');
select is(
  array(select tests.outcome(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'gif', '', p_gif => %L) $$, :'r_a', g))
          from unnest(array[jsonb_build_object('url', :'gif', 'width', 0, 'height', 278),
                            jsonb_build_object('url', :'gif', 'width', 498, 'height', 10001),
                            jsonb_build_object('url', :'gif', 'width', 49.5, 'height', 278),
                            jsonb_build_object('url', :'gif'), null]) g),
  array_fill('22023 message_gif_invalid'::text, array[5]),
  'and one without a size of 1 to 10000 pixels');
select throws_ok(format($$ select public.post_buddy_message('%s', null, gen_random_uuid(), 'text', 'hi', p_gif => '{"url": "%s", "width": 1, "height": 1}') $$,
                        :'r_a', :'gif'),
  '22023', 'message_gif_invalid', 'a text carries no GIF');

reset role;
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'gif', '', 'https://media.giphy.com/x.webp', 10, 10, false, null) $$, :'r_a', :'hana')),
  '23514', 'past the API, the table itself refuses a GIF off KLIPY''s hosts');
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'image', '', null, null, null, false, null) $$, :'r_a', :'hana')),
  '23514', 'and a photo');
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'text', 'hi', null, null, null, true, null) $$, :'r_a', :'hana')),
  '23514', 'and a spoiler outside a Section');
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'text', 'still here', null, null, null, false, now()) $$, :'r_a', :'hana')),
  '23514', 'and a tombstone that keeps its text');
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'text', 'hi', %L, 10, 10, false, null) $$, :'r_a', :'hana', :'gif')),
  '23514', 'and a text with a GIF');
select is(tests.raw_insert(format($$ (%L, null, %L, gen_random_uuid(), 'gif', '', %L, null, null, false, null) $$, :'r_a', :'hana', :'gif')),
  '23514', 'and a GIF without its size');

-- ------------------------------------------------------------------------- pages (13)

select tests.act_as(:'hana');
select public.buddy_read_messages(:'r_a') as v \gset
select ok(tests.ids(:'v') @> array[:'m1', :'m2', :'m3', :'g1']::uuid[] and not tests.ids(:'v') && array[:'s1', :'s2']::uuid[],
  'the room''s page holds the room''s messages, not a Section''s (13)');
select is((tests.ids(:'v'))[1:4], array[:'g1', :'m_max', :'m3', :'m2']::uuid[], 'newest first');
select is(tests.ids(public.buddy_read_messages(:'r_a', p_limit => 2)), array[:'g1', :'m_max']::uuid[], 'a page of two');
select is(tests.ids(public.buddy_read_messages(:'r_a', p_before => (tests.msg(:'m_max') ->> 'created_at')::timestamptz, p_limit => 2)),
  array[:'m3', :'m2']::uuid[], 'the next page: older than the last one shown');
select is(tests.ids(public.buddy_read_messages(:'r_a', p_after => (tests.msg(:'m3') ->> 'created_at')::timestamptz)),
  array[:'g1', :'m_max']::uuid[], 'catching up: newer than the newest she has');
select is(tests.ids(public.buddy_read_messages(:'r_a', :'a1')), array[:'s1r', :'s1']::uuid[], 'a Section''s thread');
select throws_ok(format($$ select public.buddy_read_messages('%s', '%s') $$, :'r_a', :'b1'),
  '22023', 'buddy_section_invalid', 'a Section of another read is refused');
select tests.act_as(:'sam');
select is(jsonb_array_length(public.buddy_read_messages(:'r_c', p_limit => 1000)), 100, 'a page is 100 at most');
select is(jsonb_array_length(public.buddy_read_messages(:'r_c')), 50, 'and 50 by default');

-- ------------------------------------------------------------------------- strangers and left members (16, 17, 12)

select tests.act_as(:'lu');
select throws_ok(format($$ select public.buddy_read_messages('%s') $$, :'r_a'), 'PT404', 'not_found', 'a stranger gets not_found (16)');
select throws_ok(format($$ select tests.say('%s', null, 'let me in') $$, :'r_a'), 'PT404', 'not_found', 'and cannot post');
select tests.act_as(:'ned');
select tests.say(:'r_a', null, 'Ned was here') as m_ned \gset
select tests.say(:'r_a', :'a1', 'Ned on chapter one') as s_ned \gset
select tests.act_as(:'kim');
select tests.say(:'r_a', :'a1', 'Answering Ned', :'s_ned') as s_kim \gset
select tests.act_as(:'ned');
select lives_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_a'), 'Ned leaves, keeping his messages');
select throws_ok(format($$ select public.buddy_read_messages('%s') $$, :'r_a'), 'PT404', 'not_found', 'a member who left gets nothing (17)');
select throws_ok(format($$ select tests.say('%s', null, 'back again') $$, :'r_a'), 'PT404', 'not_found', 'and cannot post (12)');
select tests.act_as(:'hana');
select is(tests.in_page(public.buddy_read_messages(:'r_a'), :'m_ned') -> 'author', jsonb_build_object('id', :'ned', 'name', 'Ned'),
  'his message stays, under his name');

-- ------------------------------------------------------------------------- reactions (18, 19, 20, 21)

select tests.act_as(:'ivo');
select lives_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'m1'), 'Ivo reacts');
select tests.act_as(:'jo');
select public.react_to_buddy_message(:'m1', '❤️');
select tests.act_as(:'ivo');
select is(tests.in_page(public.buddy_read_messages(:'r_a'), :'m1') -> 'reactions',
  '[{"emoji": "❤️", "count": 2, "mine": true}]'::jsonb, 'two hearts, one his');
select tests.act_as(:'hana');
select is(tests.in_page(public.buddy_read_messages(:'r_a'), :'m1') -> 'reactions',
  '[{"emoji": "❤️", "count": 2, "mine": false}]'::jsonb, 'to her, none hers');
select tests.act_as(:'ivo');
select public.react_to_buddy_message(:'m1', '😂');
select ok(tests.reaction_of(:'m1', :'ivo') = '😂' and tests.reactions_on(:'m1') = 2,
  'another emoji replaces his: one reaction per member (18)');
select is(tests.in_page(public.buddy_read_messages(:'r_a'), :'m1') -> 'reactions',
  '[{"emoji": "❤️", "count": 1, "mine": false}, {"emoji": "😂", "count": 1, "mine": true}]'::jsonb, 'in the order of the bar');
select public.react_to_buddy_message(:'m1', '😂');
select is(tests.reaction_of(:'m1', :'ivo'), null, 'the same again removes it');
select public.react_to_buddy_message(:'m1', '🔥');
select public.react_to_buddy_message(:'m1', null);
select is(tests.reaction_of(:'m1', :'ivo'), null, 'and null removes it');
select lives_ok(format($$ select public.react_to_buddy_message('%s', null) $$, :'m1'), 'null with nothing to remove: nothing');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '👍') $$, :'m1'),
  '22023', 'message_emoji_invalid', 'only the six emoji');
select tests.act_as(:'lu');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'m1'),
  'PT404', 'not_found', 'not for a stranger (21)');
select tests.act_as(:'ned');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'m1'),
  'PT404', 'not_found', 'nor for a member who left');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, gen_random_uuid()),
  'PT404', 'not_found', 'nor on a message that is not there');

select tests.clear_calls(:'kim');
select tests.fill_calls(:'kim', 'react', 59);
select tests.act_as(:'kim');
select lives_ok(format($$ select public.react_to_buddy_message('%s', '📚') $$, :'m2'), 'the 60th reaction within a minute (20)');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '📚') $$, :'m3'),
  'PT429', 'rate_limited', 'the 61st is refused');

-- ------------------------------------------------------------------------- blocks (14, 19)

select tests.act_as(:'jo');
select tests.say(:'r_a', null, 'Jo speaking') as m_jo \gset
select tests.act_as(:'pat');
select tests.say(:'r_a', null, 'Pat speaking') as m_pat \gset
select public.react_to_buddy_message(:'m2', '😮');
select tests.act_as(:'jo');
select public.react_to_buddy_message(:'m2', '😮');
select tests.block(:'pat', :'jo');

select tests.act_as(:'pat');
select public.buddy_read_messages(:'r_a') as v \gset
select ok(not (tests.ids(:'v') @> array[:'m_jo']::uuid[]) and tests.ids(:'v') @> array[:'m_pat']::uuid[],
  'the blocker no longer sees the blocked member''s messages, still her own (14)');
select is(tests.in_page(:'v', :'m2') -> 'reactions',
  '[{"emoji": "😮", "count": 1, "mine": true}, {"emoji": "📚", "count": 1, "mine": false}]'::jsonb,
  'nor his reactions');
select tests.act_as(:'jo');
select public.buddy_read_messages(:'r_a') as v \gset
select ok(not (tests.ids(:'v') @> array[:'m_pat']::uuid[]) and tests.ids(:'v') @> array[:'m_jo']::uuid[],
  'the blocked member no longer sees the blocker''s, still his own: both ways');
select is(tests.in_page(:'v', :'m2') -> 'reactions',
  '[{"emoji": "😮", "count": 1, "mine": true}, {"emoji": "📚", "count": 1, "mine": false}]'::jsonb,
  'nor her reactions');
select tests.act_as(:'hana');
select ok(tests.ids(public.buddy_read_messages(:'r_a')) @> array[:'m_jo', :'m_pat']::uuid[],
  'everyone else sees both; nothing was removed');
select tests.act_as(:'pat');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'m_jo'),
  'PT404', 'not_found', 'no reaction across a block (19)');
select throws_ok(format($$ select tests.say('%s', null, 'answering Jo', '%s') $$, :'r_a', :'m_jo'),
  '22023', 'message_reply_unavailable', 'no answer across a block');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'m_jo'),
  'PT404', 'not_found', 'no report across a block');
select tests.act_as(:'jo');
select throws_ok(format($$ select public.delete_buddy_message('%s') $$, :'m_pat'),
  'PT404', 'not_found', 'and the other way round, the same');

-- ------------------------------------------------------------------------- delete (22, 23, 24, 25, 15, 19)

select tests.act_as(:'jo');
select public.react_to_buddy_message(:'g1', '🔥');
select tests.act_as(:'hana');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'g1'), 'the author deletes her GIF');
select ok(tests.msg(:'g1') ->> 'body' = '' and tests.msg(:'g1') -> 'media_url' = 'null'::jsonb
          and tests.msg(:'g1') -> 'media_width' = 'null'::jsonb and tests.msg(:'g1') ->> 'deleted_by' = :'hana'
          and tests.msg(:'g1') -> 'deleted_at' <> 'null'::jsonb and tests.reactions_on(:'g1') = 0,
  'a tombstone: no body, no address, no size, no reactions, deleted by her (22)');
select tests.in_page(public.buddy_read_messages(:'r_a'), :'g1') as v \gset
select ok(:'v'::jsonb -> 'body' = 'null'::jsonb and :'v'::jsonb -> 'media_url' = 'null'::jsonb
          and :'v'::jsonb -> 'reactions' = '[]'::jsonb and :'v'::jsonb -> 'deleted_at' <> 'null'::jsonb,
  'the page shows it as a tombstone, with no body or address (15)');
select tests.msg(:'g1') ->> 'deleted_at' as g1_deleted \gset
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'g1'), 'deleting it again (25)');
select is(tests.msg(:'g1') ->> 'deleted_at', :'g1_deleted', 'changes nothing');
select tests.act_as(:'jo');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'g1'),
  'PT409', 'message_unavailable', 'no reaction on a tombstone (19)');
select throws_ok(format($$ select tests.say('%s', null, 'answering a tombstone', '%s') $$, :'r_a', :'g1'),
  '22023', 'message_reply_unavailable', 'no answer to a tombstone (8)');
select throws_ok(format($$ select public.delete_buddy_message('%s') $$, :'s_kim'),
  'PT403', 'message_not_yours', 'another member cannot delete it (24)');
select tests.act_as(:'hana');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'s_kim'), 'the host deletes anyone''s');
select is(tests.msg(:'s_kim') ->> 'deleted_by', :'hana', 'as the host (23)');
select tests.act_as(:'lu');
select throws_ok(format($$ select public.delete_buddy_message('%s') $$, :'m1'), 'PT404', 'not_found', 'a stranger gets not_found');

-- ------------------------------------------------------------------------- counts and unread

select tests.act_as(:'hana');
select public.buddy_read(:'r_a') as v \gset
select is(tests.keys(:'v' ::jsonb -> 'room'), array['count', 'unread'], 'buddy_read has the room''s numbers');
select is(tests.keys(tests.sec(:'v', 1)),
  array['count', 'end_page', 'id', 'kind', 'label', 'position', 'start_page', 'to_fraction', 'unread'], 'and each Section''s');
select is((tests.sec(:'v', 1) ->> 'count')::int, 3, 'Section 1: three messages, the tombstone not counted');
select is((tests.sec(:'v', 3) ->> 'count')::int, 0, 'an empty Section counts 0');
select is((:'v'::jsonb -> 'room' ->> 'count')::int, tests.live_in_room(:'r_a'), 'the room counts its live messages');
select tests.act_as(:'pat');
select is((public.buddy_read(:'r_a') -> 'room' ->> 'count')::int, tests.live_in_room(:'r_a') - 1,
  'for the blocker the room counts one less: the blocked member''s message is left out');

-- Kim: the room and Section 1 have messages of others she has not read.
select tests.act_as(:'kim');
select public.buddy_read(:'r_a') as v \gset
select ok((:'v'::jsonb -> 'room' ->> 'unread')::int > 0 and (tests.sec(:'v', 1) ->> 'unread')::int = 3,
  'her unread: the room''s, and in Section 1 three of others (not her own, now a tombstone)');
select lives_ok(format($$ select public.mark_buddy_read('%s', null, null) $$, :'r_a'), 'she reads the room');
select is((public.buddy_read(:'r_a') -> 'room' ->> 'unread')::int, 0, 'and its unread drops to 0');
select tests.room_cursor(:'r_a', :'kim') as kim_room \gset
select public.mark_buddy_read(:'r_a', null, :'kim_room'::timestamptz - interval '1 hour');
select is(tests.room_cursor(:'r_a', :'kim'), :'kim_room'::timestamptz, 'a cursor never moves back (26)');
select public.mark_buddy_read(:'r_a', null, clock_timestamp() + interval '1 day');
select ok(tests.room_cursor(:'r_a', :'kim') < clock_timestamp() + interval '1 minute', 'nor far into the future');
select public.mark_buddy_read(:'r_a', :'a1', (tests.msg(:'s1') ->> 'created_at')::timestamptz);
select is((tests.sec(public.buddy_read(:'r_a'), 1) ->> 'unread')::int, 2, 'Section 1 read up to the first: two left');
select public.mark_buddy_read(:'r_a', :'a1', (tests.msg(:'s1') ->> 'created_at')::timestamptz - interval '1 hour');
select is(tests.cursor(:'a1', :'kim'), (tests.msg(:'s1') ->> 'created_at')::timestamptz, 'a Section''s cursor never moves back either');
select public.mark_buddy_read(:'r_a', :'a1', null);
select is((tests.sec(public.buddy_read(:'r_a'), 1) ->> 'unread')::int, 0, 'read through: none left');
select throws_ok(format($$ select public.mark_buddy_read('%s', '%s', null) $$, :'r_a', :'b1'),
  '22023', 'buddy_section_invalid', 'a Section of another read is refused');
select tests.act_as(:'lu');
select throws_ok(format($$ select public.mark_buddy_read('%s', null, null) $$, :'r_a'), 'PT404', 'not_found', 'and a stranger');

-- The list counts only what she may open: Kim's Section is not set (read_through 0), so no Section is open.
select tests.act_as(:'kim');
select tests.unread_in_list(:'r_a') as kim_before \gset
select is(:'kim_before'::int, 0, 'Kim has read the room and Section 1: nothing unread in her list');
select tests.act_as(:'hana');
select tests.say(:'r_a', :'a3', 'Section three talk') as s3 \gset
select tests.say(:'r_a', :'a_end', 'The ending!') as s_end \gset
select tests.act_as(:'kim');
select is((tests.sec(public.buddy_read(:'r_a'), 3) ->> 'unread')::int, 1, 'buddy_read counts the new message in Section 3');
select is(tests.unread_in_list(:'r_a'), 0, 'her list does not: Section 3 is veiled for her');
select tests.set_hand(:'r_a', :'kim', 3::smallint);
select is(tests.unread_in_list(:'r_a'), 2, 'through Section 3, Sections 2 and 3 count (and still not the end Section)');
select tests.set_hand(:'r_a', :'kim', 4::smallint);
select is(tests.unread_in_list(:'r_a'), 3, 'through every part, the end Section counts too');
select tests.act_as(:'hana');
select tests.say(:'r_a', null, 'Room again') as m_room2 \gset
select tests.act_as(:'kim');
select is(tests.unread_in_list(:'r_a'), 4, 'and the room always');
select is(tests.keys((select r from jsonb_array_elements(public.my_buddy_reads() -> 'reads') r where r ->> 'id' = :'r_a')),
  array['book', 'id', 'member_count', 'role', 'sections', 'starts_on', 'status', 'unread', 'where'],
  'her list keeps its shape: unread is a count of messages, nothing about reading');
select is(public.buddy_read_messages(:'r_a')::text ~ '"(read_through|hand_through|auto_through|progress[a-z_]*|percent|fraction|page[a-z_]*)":',
  false, 'and a page of messages carries no number about reading');

-- ------------------------------------------------------------------------- archived and finished (9)

select tests.act_as(:'ivo');
select public.finish_buddy_read(:'r_b');
select tests.act_as(:'hana');
select lives_ok(format($$ select tests.say('%s', null, 'We finished!') $$, :'r_b'), 'a finished read still takes messages (9)');
select tests.say(:'r_b', :'b1', 'Section one of B') as sb1 \gset
select tests.act_as(:'ivo');
select lives_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'sb1'), 'and reactions');
select public.delete_buddy_message(:'sb1');
select throws_ok(format($$ select public.set_buddy_sections('%s', tests.secs(3)) $$, :'r_b'),
  'PT409', 'buddy_sections_locked', 'a tombstone in a Section thread locks the division too');
select public.archive_buddy_read(:'r_b');
select tests.act_as(:'hana');
select throws_ok(format($$ select tests.say('%s', null, 'Anyone?') $$, :'r_b'),
  'PT409', 'buddy_read_archived', 'an archived read refuses a new message');
select throws_ok(format($$ select public.react_to_buddy_message('%s', '❤️') $$, :'mb1'),
  'PT409', 'buddy_read_archived', 'and a reaction');
select ok(jsonb_array_length(public.buddy_read_messages(:'r_b')) > 0, 'its messages can still be read');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'mb1'), 'and her own deleted');
select lives_ok(format($$ select public.mark_buddy_read('%s', null, null) $$, :'r_b'), 'and marked read');

-- ------------------------------------------------------------------------- Sections: rename, not replace

select tests.act_as(:'hana');
select throws_ok(format($$ select public.set_buddy_sections('%s', tests.secs(5)) $$, :'r_a'),
  'PT409', 'buddy_sections_locked', 'with messages in a Section thread, the division cannot be replaced');
select lives_ok(format($$ select public.set_buddy_sections('%s', tests.secs(4, 'Part')) $$, :'r_a'), 'but renamed');
select is(tests.section_ids(:'r_a'), array[:'a1', :'a2', :'a3', :'a4', :'a_end']::uuid[], 'keeping the Sections and their threads');
select is(tests.msg(:'s1') ->> 'section_id', :'a1', 'with their messages');
select tests.act_as(:'sam');
select lives_ok(format($$ select public.set_buddy_sections('%s', tests.secs(3)) $$, :'r_c'),
  'messages only in the room: the division can still be replaced');

-- ------------------------------------------------------------------------- report (27, 28, 29, 30)

select tests.name_owner(:'tom');
select tests.act_as(:'hana');
select tests.say(:'r_a', :'a2', repeat('Long words ', 100)) as s_long \gset
select tests.act_as(:'jo');
select lives_ok(format($$ select public.report_buddy_message('%s', 'harassment', '  She keeps doing this.  ') $$, :'s_long'),
  'Jo reports a message');
select is(tests.reports_of(:'jo'), 1, 'one feedback row of kind report (27)');
select tests.last_report(:'jo') as v \gset
select ok(:'v'::jsonb ->> 'member_id' = :'jo' and :'v'::jsonb ->> 'body' = E'Buddy read report: harassment\n\nShe keeps doing this.',
  'as hers, with her reason and note');
select is(tests.keys(:'v'::jsonb -> 'context'), array['author', 'buddy_read', 'excerpt', 'message', 'section'], 'its context');
select ok(:'v'::jsonb -> 'context' ->> 'buddy_read' = :'r_a' and :'v'::jsonb -> 'context' ->> 'section' = :'a2'
          and :'v'::jsonb -> 'context' ->> 'message' = :'s_long' and :'v'::jsonb -> 'context' ->> 'author' = :'hana'
          and char_length(:'v'::jsonb -> 'context' ->> 'excerpt') = 300
          and octet_length((:'v'::jsonb -> 'context')::text) <= 4000,
  'names the read, the Section, the message and its author, with the first 300 characters, under 4000 bytes');
select tests.act_as(:'tom');
select is((select f.kind from public.feedback_list(100) f where f.context ->> 'message' = :'s_long'), 'report',
  'the owner finds it in her inbox');
select tests.act_as(:'jo');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'m_jo'),
  '22023', 'report_self', 'not her own message (28)');
select throws_ok(format($$ select public.report_buddy_message('%s', 'boring') $$, :'m1'),
  '22023', 'report_reason_invalid', 'a reason of the four');
select throws_ok(format($$ select public.report_buddy_message('%s', 'other', repeat('x', 1001)) $$, :'m1'),
  '22023', 'report_note_too_long', 'a note of 1000 characters at most');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'g1'),
  'PT409', 'message_unavailable', 'not a tombstone');
select tests.act_as(:'lu');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'m1'),
  'PT404', 'not_found', 'members only (29)');
select tests.act_as(:'ned');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'m1'),
  'PT404', 'not_found', 'not a member who left');
select tests.fill_feedback(:'jo', 4);
select tests.act_as(:'jo');
select throws_ok(format($$ select public.report_buddy_message('%s', 'spam') $$, :'m1'),
  'PT429', 'rate_limited', 'the feedback limiter applies: a sixth message within the hour is refused (30)');
select tests.act_as(:'kim');
select throws_ok($$ insert into public.feedback (member_id, kind, body) values (auth.uid(), 'report', 'A made-up report') $$,
  '42501', null, 'a member cannot write a report herself');
select lives_ok($$ insert into public.feedback (member_id, kind, body) values (auth.uid(), 'bug', 'Still a bug report') $$,
  'she still sends a bug report');

-- ------------------------------------------------------------------------- leave with her messages

select tests.act_as(:'pat');
select tests.say(:'r_a', :'a1', 'Pat on one') as s_pat \gset
select tests.act_as(:'ivo');
select tests.say(:'r_a', :'a1', 'Answering Pat', :'s_pat') as s_ivo \gset
select tests.act_as(:'pat');
select public.mark_buddy_read(:'r_a', :'a1', null);
select tests.msgs_in(:'r_a') as before_leave \gset
select tests.msgs_by(:'r_a', :'pat') as pat_msgs \gset
select lives_ok(format($$ select public.leave_buddy_read('%s', true) $$, :'r_a'), 'Pat leaves with her messages');
select is(tests.msgs_by(:'r_a', :'pat'), 0, 'hers are gone');
select is(tests.msgs_in(:'r_a'), :'before_leave'::int - :'pat_msgs'::int, 'and only hers');
select is(tests.msg(:'s_ivo') -> 'reply_to', 'null'::jsonb, 'an answer to one of hers stays, without the link');
select is(tests.reaction_of(:'m2', :'pat'), '😮', 'her reactions stay');
select is(tests.cursors_of(:'pat'), 0, 'her Section cursors are gone');
select tests.act_as(:'hana');
select public.mark_buddy_read(:'r_a', :'a1', null);
select tests.act_as(:'jo');
select public.mark_buddy_read(:'r_a', :'a1', null);
select tests.act_as(:'hana');
select public.remove_from_buddy_read(:'r_a', :'jo');
select is(tests.cursors_of(:'jo'), 0, 'a removed member''s cursors go too');
select tests.act_as(:'quin');
select public.leave_buddy_read(:'r_c');
select is(tests.msgs_by(:'r_c', :'quin'), 600, 'leaving without deleting keeps every message');

-- ------------------------------------------------------------------------- account deletion (31, 32)

select tests.act_as(:'ola');
select gen_random_uuid() as c_ola \gset
select public.post_buddy_message(:'r_a', null, :'c_ola', 'text', 'Ola''s thoughts') ->> 'id' as m_ola \gset
select public.react_to_buddy_message(:'m1', '😢');
select public.mark_buddy_read(:'r_a', :'a1', null);
select tests.clear_calls(:'kim');
select tests.act_as(:'kim');
select public.react_to_buddy_message(:'m_ola', '❤️');
select tests.say(:'r_a', null, 'Answering Ola', :'m_ola') as m_kim_ola \gset
select public.post_buddy_message(:'r_a', null, :'c_ola', 'text', 'Kim with the same client id') ->> 'id' as m_kim_same \gset
select isnt(:'m_kim_same'::uuid, :'m_ola'::uuid, 'another member''s client id is her own: the same value is a new message (32)');
select tests.act_as(:'ola');
select lives_ok($$ select public.delete_my_account() $$, 'Ola deletes her account');
select ok(tests.msg(:'m_ola') is null and tests.reactions_by(:'ola') = 0 and tests.cursors_of(:'ola') = 0,
  'her messages, reactions and cursors are gone (31)');
select is(tests.reactions_on(:'m1'), 1, 'the other reactions on the message she reacted to stay');
select ok(tests.msg(:'m_kim_ola') -> 'reply_to' = 'null'::jsonb and tests.msg(:'m_kim_ola') ->> 'body' = 'Answering Ola',
  'an answer to hers stays, without the link');
select is(tests.msg(:'m_kim_same') ->> 'author_id', :'kim', 'and the message with the same client id stays Kim''s');
select tests.act_as(:'kim');
select is(public.post_buddy_message(:'r_a', null, :'c_ola', 'text', 'again') ->> 'id', :'m_kim_same',
  'for whom it still answers the first message');

-- ------------------------------------------------------------------------- a read deleted takes its messages

select tests.act_as(:'ivo');
select public.leave_buddy_read(:'r_b');
select tests.act_as(:'hana');
select public.leave_buddy_read(:'r_b');
select ok(tests.read_gone(:'r_b') and tests.msgs_in(:'r_b') = 0, 'the last member out: the read and its messages are gone');

select * from finish();
rollback;
