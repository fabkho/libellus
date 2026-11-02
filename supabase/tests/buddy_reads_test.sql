-- Buddy reads, D1: rooms, members and Sections (docs/plans/buddy-read-shared.md parts 4 and 5,
-- the checklist of part 4.5, items 33 to 45):
--   supabase test db
--
-- A host starts a read of a Catalogue Book in her Library, with Sections the server checks; one
-- active read per host and Book, ten active reads per member, twelve rows per read counting waiting
-- invitations. She invites people she follows and nobody blocked; a link lets anyone else in, and the
-- link answers the same null for a wrong, off, renewed, ended or full token and to anyone blocked
-- with any member. Leaving hands the host role to the earliest joiner, the last one out deletes the
-- read, and so does an account deletion. Co-members see each other's photo while both are in.
-- Other members see where she is as a Section only. No member reads a table; a stranger gets
-- not_found. The follower-facing functions still show no progress. Assertions ask about rows this
-- test made, never counts of a table.

begin;
select plan(220);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BUDDY-1', 'buddy reads test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-BUDDY-1', 'name', p_name)), now(), now(), now());
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

-- A list of cards holds this member.
create or replace function tests.has(p_list jsonb, p_member uuid)
returns boolean language sql as $$
  select coalesce(p_list @> jsonb_build_array(jsonb_build_object('id', p_member)), false)
$$;

-- The card of a member in buddy_read()'s list.
create or replace function tests.card(p_read jsonb, p_member uuid)
returns jsonb language sql as $$
  select c from jsonb_array_elements(p_read -> 'members') c where c ->> 'id' = p_member::text
$$;

-- The read in her my_buddy_reads() list (reads or invitations).
create or replace function tests.listed(p_list jsonb, p_read uuid)
returns jsonb language sql as $$
  select r from jsonb_array_elements(p_list) r where r ->> 'id' = p_read::text
$$;

-- Past RLS, for the assertions.
create or replace function tests.read_row(p_read uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(r) from public.buddy_reads r where r.id = p_read
$$;
create or replace function tests.member_row(p_read uuid, p_member uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.buddy_read_members m where m.buddy_read_id = p_read and m.member_id = p_member
$$;
create or replace function tests.rows_of(p_read uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_read_members where buddy_read_id = p_read
$$;
create or replace function tests.section_ids(p_read uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.buddy_read_sections where buddy_read_id = p_read
$$;
create or replace function tests.calls(p_member uuid, p_kind text)
returns integer language sql security definer as $$
  select count(*)::integer from private.buddy_calls where member_id = p_member and kind = p_kind
$$;
create or replace function tests.fill_calls(p_member uuid, p_kind text, p_n integer)
returns void language sql security definer as $$
  insert into private.buddy_calls (member_id, kind) select p_member, p_kind from generate_series(1, p_n)
$$;
create or replace function tests.clear_calls(p_member uuid)
returns void language sql security definer as $$
  delete from private.buddy_calls where member_id = p_member
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
create or replace function tests.unblock(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  delete from public.blocks where blocker_id = p_blocker and blocked_id = p_blocked
$$;
-- She is in n more active reads (made past the API, with no host): the 10-read limit.
create or replace function tests.in_reads(p_member uuid, p_book uuid, p_n integer)
returns void language plpgsql security definer as $$
declare v_read uuid;
begin
  for i in 1 .. p_n loop
    insert into public.buddy_reads (book_id, client_id) values (p_book, gen_random_uuid()) returning id into v_read;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at)
    values (v_read, p_member, 'member', clock_timestamp());
  end loop;
end;
$$;
create or replace function tests.fill_old_calls(p_member uuid, p_kind text, p_n integer)
returns void language sql security definer as $$
  insert into private.buddy_calls (member_id, kind, at)
  select p_member, p_kind, now() - interval '2 hours' from generate_series(1, p_n)
$$;
create or replace function tests.set_auto(p_read uuid, p_member uuid, p_auto smallint)
returns void language sql security definer as $$
  update public.buddy_read_members set auto_through = p_auto where buddy_read_id = p_read and member_id = p_member
$$;
create or replace function tests.removed(p_read uuid, p_member uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from private.buddy_read_removed where buddy_read_id = p_read and member_id = p_member)
$$;
-- She was in n reads that ended (made past the API).
create or replace function tests.in_ended_reads(p_member uuid, p_book uuid, p_n integer)
returns void language plpgsql security definer as $$
declare v_read uuid;
begin
  for i in 1 .. p_n loop
    insert into public.buddy_reads (book_id, client_id, status, finished_at)
    values (p_book, gen_random_uuid(), 'finished', clock_timestamp()) returning id into v_read;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at)
    values (v_read, p_member, 'member', clock_timestamp());
  end loop;
end;
$$;
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

-- The detail of the refusal a statement raises.
create or replace function tests.detail_of(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v;
end;
$$;

-- What create_buddy_read answers to a list of Sections: 'accepted', or the refusal.
create or replace function tests.bad_sections(p_book uuid, p_sections jsonb, p_from text default 'count', p_pages integer default null)
returns text language plpgsql as $$
begin
  perform public.create_buddy_read(p_book, gen_random_uuid(), p_sections, p_from => p_from, p_page_count => p_pages);
  return 'accepted';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

-- ------------------------------------------------------------------------- members

select tests.member('hana@buddy.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@buddy.pgtap.test', 'Ivo') as ivo \gset
select tests.member('jo@buddy.pgtap.test', 'Jo') as jo \gset
select tests.member('kim@buddy.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@buddy.pgtap.test', 'Lu') as lu \gset
select tests.member('max@buddy.pgtap.test', 'Max') as max \gset
select tests.member('ned@buddy.pgtap.test', 'Ned') as ned \gset
select tests.member('ola@buddy.pgtap.test', 'Ola') as ola \gset
select tests.member('pat@buddy.pgtap.test', 'Pat') as pat \gset
select tests.member('quin@buddy.pgtap.test', 'Quin') as quin \gset
select tests.member('rae@buddy.pgtap.test', 'Rae') as rae \gset
select tests.member('sam@buddy.pgtap.test', 'Sam') as sam \gset
select tests.member('tom@buddy.pgtap.test', 'Tom') as tom \gset
select tests.member('uma@buddy.pgtap.test', 'Uma') as uma \gset
select tests.member('vic@buddy.pgtap.test', 'Vic') as vic \gset
select tests.member('wes@buddy.pgtap.test', 'Wes') as wes \gset
select tests.member('xan@buddy.pgtap.test', 'Xan') as xan \gset
select tests.member('yul@buddy.pgtap.test', 'Yul') as yul \gset
select tests.member('zed@buddy.pgtap.test', 'Zed') as zed \gset
select tests.member('ari@buddy.pgtap.test', 'Ari') as ari \gset
select tests.member('bo@buddy.pgtap.test', 'Bo') as bo \gset
select tests.member('cal@buddy.pgtap.test', 'Cal') as cal \gset
select tests.member('dee@buddy.pgtap.test', 'Dee') as dee \gset
select tests.member('fay@buddy.pgtap.test', 'Fay') as fay \gset
select tests.member('gus@buddy.pgtap.test', 'Gus') as gus \gset
select tests.member('hal@buddy.pgtap.test', 'Hal') as hal \gset

-- Hana follows eleven of them and Uma (who blocked her); not Tom, not Vic. Wes follows Hana.
select tests.follow(:'hana', m)
  from unnest(array[:'ivo', :'jo', :'kim', :'lu', :'max', :'ned', :'ola', :'pat', :'quin', :'rae', :'sam', :'uma']::uuid[]) m;
select tests.block(:'uma', :'hana');
select tests.follow(:'wes', :'hana');
select tests.follow(:'ari', :'bo');
select tests.follow(:'bo', :'fay');

-- Their Libraries.
select tests.act_as(:'hana');
select (public.add_to_library(tests.snap('Buddy Dune', 'OL900001W'))).id as e_dune \gset
select (public.add_to_library(tests.snap('Buddy Hyperion'))).id as e_hyp \gset
select (public.add_to_library(tests.snap('Buddy Ilium'))).id as e_ilium \gset
select (public.add_manual_book('Buddy Mine', array['Me'], null, 200)).id as e_mine \gset
select tests.act_as(:'ivo');
select (public.add_to_library(tests.snap('Buddy Dune, another edition', 'OL900001W'))).id as e_ivo_dune \gset
select (public.add_to_library(tests.snap('Buddy Other'))).id as e_ivo_other \gset
select tests.act_as(:'pat');
select (public.add_to_library(tests.snap('Buddy Pat'))).id as e_pat \gset
select tests.act_as(:'tom');
select (public.add_to_library(tests.snap('Buddy Tom'))).id as e_tom \gset
select (public.add_to_library(tests.snap('Buddy Tom, the sequel'))).id as e_tom2 \gset
select tests.act_as(:'xan');
select (public.add_to_library(tests.snap('Buddy Xan'))).id as e_xan \gset
select tests.act_as(:'yul');
select (public.add_to_library(tests.snap('Buddy Xan'))).id as e_yul_xan \gset
select tests.act_as(:'ari');
select (public.add_to_library(tests.snap('Buddy Ari'))).id as e_ari \gset
select tests.act_as(:'bo');
select (public.add_to_library(tests.snap('Buddy Bo'))).id as e_bo \gset
select tests.act_as(:'gus');
select (public.add_to_library(tests.snap('Buddy Gus'))).id as e_gus \gset
select tests.act_as(:'hal');
select (public.add_to_library(tests.snap('Buddy Gus'))).id as e_hal_gus \gset
reset role;

select tests.book_of(:'e_dune') as b_dune \gset
select tests.book_of(:'e_hyp') as b_hyp \gset
select tests.book_of(:'e_ilium') as b_ilium \gset
select tests.book_of(:'e_mine') as b_mine \gset
select tests.book_of(:'e_ivo_other') as b_ivo_other \gset
select tests.book_of(:'e_pat') as b_pat \gset
select tests.book_of(:'e_tom') as b_tom \gset
select tests.book_of(:'e_tom2') as b_tom2 \gset
select tests.book_of(:'e_xan') as b_xan \gset
select tests.book_of(:'e_ari') as b_ari \gset
select tests.book_of(:'e_bo') as b_bo \gset
select tests.book_of(:'e_gus') as b_gus \gset

-- ------------------------------------------------------------------------- grants and RLS (42)

select is(
  (select count(*)::int from unnest(array[
      'public.create_buddy_read(uuid, uuid, jsonb, uuid[], boolean, date, text, integer)', 'public.my_buddy_reads()',
      'public.buddy_read(uuid)', 'public.invite_to_buddy_read(uuid, uuid[])', 'public.buddy_read_link(uuid, boolean, boolean)',
      'public.buddy_read_target(text)', 'public.join_buddy_read(text)', 'public.answer_buddy_invite(uuid, boolean)',
      'public.leave_buddy_read(uuid, boolean)', 'public.remove_from_buddy_read(uuid, uuid)', 'public.finish_buddy_read(uuid)',
      'public.archive_buddy_read(uuid)', 'public.set_buddy_sections(uuid, jsonb, text, integer)',
      'public.link_buddy_entry(uuid, uuid)', 'public.set_buddy_hand(uuid, integer)'
    ]) f where has_function_privilege('anon', f::regprocedure, 'execute')
            or has_function_privilege('public', f::regprocedure, 'execute')
            or not has_function_privilege('authenticated', f::regprocedure, 'execute')
            or not (select prosecdef from pg_proc where oid = f::regprocedure)
            or (select proconfig from pg_proc where oid = f::regprocedure)
                   is distinct from array['search_path=pg_catalog, public, private']),
  0, 'the fifteen functions: members only, security definer, search path pinned');
select is(
  (select count(*)::int from unnest(array['public.buddy_reads', 'public.buddy_read_members', 'public.buddy_read_sections']) t,
          unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
    where has_table_privilege(r, t, p)),
  0, 'no table is granted to anon or authenticated');
select is(
  (select count(*)::int from pg_class
    where oid in ('public.buddy_reads'::regclass, 'public.buddy_read_members'::regclass,
                  'public.buddy_read_sections'::regclass, 'private.buddy_calls'::regclass)
      and relrowsecurity),
  4, 'RLS is on for the four tables');
select is(
  (select count(*)::int from pg_policies where tablename in ('buddy_reads', 'buddy_read_members', 'buddy_read_sections', 'buddy_calls')),
  0, 'and none has a policy');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'buddy%'
      and coalesce(array_to_string(p.proconfig, ','), '') not like 'search_path=%'),
  0, 'every buddy helper pins its search path');
select is(
  (select count(*)::int
     from pg_constraint c
    where c.contype = 'f'
      and c.conrelid in ('public.buddy_reads'::regclass, 'public.buddy_read_members'::regclass,
                         'public.buddy_read_sections'::regclass, 'private.buddy_calls'::regclass)
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])),
  0, 'every foreign key leads an index');

select tests.act_as(:'hana');
select throws_ok($$ select * from public.buddy_reads $$, '42501', null, 'a member cannot select buddy_reads');
select throws_ok($$ select * from public.buddy_read_members $$, '42501', null, 'nor buddy_read_members');
select throws_ok($$ select * from public.buddy_read_sections $$, '42501', null, 'nor buddy_read_sections');
select throws_ok($$ select * from private.buddy_calls $$, '42501', null, 'nor the calls');
select tests.act_anon();
select throws_ok($$ select public.my_buddy_reads() $$, '42501', null, 'signed out, nothing can be called');
select tests.act_nobody();
select throws_ok($$ select public.my_buddy_reads() $$, '42501', 'not_signed_in', 'a token with no member is not_signed_in');
select throws_ok($$ select public.buddy_read_target('AAAAAAAAAAAAAAAAAAAAAA') $$, '42501', 'not_signed_in', 'also for a link');

-- ------------------------------------------------------------------------- create (33, 34, 35, 36)

select tests.act_as(:'hana');
select gen_random_uuid() as c_a \gset
select public.create_buddy_read(:'b_dune', :'c_a', tests.secs(4),
                                array[:'ivo', :'jo', :'tom', :'uma', null]::uuid[], true) as made_a \gset
select (:'made_a'::jsonb ->> 'id') as r_a, (:'made_a'::jsonb ->> 'link_token') as t_a \gset

select is(tests.keys(:'made_a'), array['id', 'invited', 'link_token', 'skipped'], 'create answers id, link_token, invited, skipped');
select ok(:'t_a' ~ '^[A-Za-z0-9_-]{22}$', 'with the link on, a 22-character token');
select ok(:'made_a'::jsonb -> 'invited' @> to_jsonb(array[:'ivo', :'jo']) and jsonb_array_length(:'made_a'::jsonb -> 'invited') = 2,
  'the two people she follows are invited');
select ok(:'made_a'::jsonb -> 'skipped' @> to_jsonb(array[:'tom', :'uma']) and jsonb_array_length(:'made_a'::jsonb -> 'skipped') = 2,
  'one she does not follow and one who blocked her are skipped, not refused');
select is(public.create_buddy_read(:'b_dune', :'c_a', tests.secs(4)) ->> 'id', :'r_a', 'the same client id again answers the same read (33)');
select is(tests.rows_of(:'r_a'), 3, 'and made nothing more: Hana and two invitations');
select is(tests.read_row(:'r_a') ->> 'host_id', :'hana', 'she is its host');
select is(tests.member_row(:'r_a', :'hana') ->> 'entry_id', :'e_dune', 'and her member row links her Library entry');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_dune'),
  'PT409', 'buddy_read_exists', 'a second active read of the same Book is refused (36)');

select is(tests.detail_of(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_dune')),
  :'r_a', 'and the refusal names the read she has');

select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_mine'),
  '22023', 'buddy_book_invalid', 'a Manual book is refused (34)');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_ivo_other'),
  '22023', 'buddy_book_invalid', 'a Catalogue Book not in her Library is refused');
select throws_ok($$ select public.create_buddy_read(gen_random_uuid(), gen_random_uuid(), tests.secs(3)) $$,
  '22023', 'buddy_book_invalid', 'an unknown Book is refused');
select throws_ok(format($$ select public.create_buddy_read('%s', null, tests.secs(3)) $$, :'b_hyp'),
  '22023', 'client_id_required', 'a create without a client id is refused');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3), p_starts => current_date + 400) $$, :'b_hyp'),
  '22023', 'buddy_starts_invalid', 'a start day more than a year away is refused');

-- Sections (35): each is refused as buddy_sections_invalid.

select is(tests.bad_sections(:'b_hyp', '{"kind": "part"}'), '22023 buddy_sections_invalid', 'Sections must be a list');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "end", "label": "The whole book", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'at least one part');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.5}, {"kind": "part", "label": "B", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'an end Section is required');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "end", "label": "The whole book", "to_fraction": 1}, {"kind": "part", "label": "A", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'the end Section comes last');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.6}, {"kind": "part", "label": "B", "to_fraction": 0.5}, {"kind": "end", "label": "W", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'parts go forward');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.5}, {"kind": "end", "label": "W", "to_fraction": 0.9}]'),
  '22023 buddy_sections_invalid', 'the end Section ends at 1');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.5}, {"kind": "end", "label": "W", "to_fraction": 1}, {"kind": "end", "label": "W", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'one end Section only');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "  ", "to_fraction": 0.5}, {"kind": "end", "label": "W", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'a blank label is refused');
select is(tests.bad_sections(:'b_hyp', jsonb_build_array(jsonb_build_object('kind', 'part', 'label', repeat('x', 121), 'to_fraction', 0.5),
                                                         jsonb_build_object('kind', 'end', 'label', 'W', 'to_fraction', 1))),
  '22023 buddy_sections_invalid', 'a label of 121 characters is refused');
select is(tests.bad_sections(:'b_hyp', jsonb_build_array(jsonb_build_object('kind', 'part', 'label', E'\u00a0\u00a0', 'to_fraction', 0.5),
                                                         jsonb_build_object('kind', 'end', 'label', 'W', 'to_fraction', 1))),
  '22023 buddy_sections_invalid', 'a label of no-break spaces is blank too');
select is(tests.bad_sections(:'b_hyp', jsonb_build_array(jsonb_build_object('kind', 'part', 'label', E'A\nB', 'to_fraction', 0.5),
                                                         jsonb_build_object('kind', 'end', 'label', 'W', 'to_fraction', 1))),
  '22023 buddy_sections_invalid', 'a label with a control character is refused');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.33333}, {"kind": "end", "label": "W", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'a fraction of more than four places is refused');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "start_page": 1, "end_page": 50, "to_fraction": 0.5}, {"kind": "part", "label": "B", "start_page": 52, "end_page": 100, "to_fraction": 1}, {"kind": "end", "label": "W", "to_fraction": 1}]', 'pages', 100),
  '22023 buddy_sections_invalid', 'page ranges follow on without a gap');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "start_page": 1, "end_page": 50, "to_fraction": 0.5}, {"kind": "part", "label": "B", "start_page": 51, "end_page": 100, "to_fraction": 1}, {"kind": "end", "label": "W", "to_fraction": 1}]', 'pages'),
  '22023 buddy_sections_invalid', 'Sections by pages need the page count');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "to_fraction": 0.5}, {"kind": "part", "label": "B", "to_fraction": 1}, {"kind": "end", "label": "W", "to_fraction": 1}]', 'pages', 100),
  '22023 buddy_sections_invalid', 'and pages on every part');
select is(tests.bad_sections(:'b_hyp', '[{"kind": "part", "label": "A", "start_page": 1, "to_fraction": 0.5}, {"kind": "end", "label": "W", "to_fraction": 1}]'),
  '22023 buddy_sections_invalid', 'a start page needs an end page');
select is(tests.bad_sections(:'b_hyp', tests.secs(101)), '22023 buddy_sections_invalid', '101 parts are too many');
select is(tests.bad_sections(:'b_hyp', tests.secs(2), 'chapters'), '22023 buddy_sections_invalid', 'an unknown division is refused');

select public.create_buddy_read(:'b_hyp', gen_random_uuid(),
  '[{"kind": "part", "label": "Pages 1–50", "start_page": 1, "end_page": 50, "to_fraction": 0.5},
    {"kind": "part", "label": "Pages 51–100", "start_page": 51, "end_page": 100, "to_fraction": 1},
    {"kind": "end", "label": "The whole book", "to_fraction": 1}]', p_from => 'pages', p_page_count => 100) ->> 'id' as r_h \gset
select is(public.buddy_read(:'r_h') -> 'sections' -> 0 -> 'end_page', '50'::jsonb, 'Sections by pages keep their pages');
select is(public.buddy_read(:'r_h') ->> 'sections_from', 'pages', 'and the read says how it was divided');

-- ------------------------------------------------------------------------- one read, as its host

select public.buddy_read(:'r_a') as v \gset
select is(tests.keys(:'v'),
  array['archived_at', 'book', 'can_manage', 'finished_at', 'id', 'invited', 'link_token', 'me', 'members', 'page_count',
        'role', 'sections', 'sections_from', 'starts_on', 'status'],
  'buddy_read answers the screen');
select ok((:'v'::jsonb ->> 'can_manage')::boolean and :'v'::jsonb ->> 'role' = 'host', 'the host manages it');
select is(:'v'::jsonb -> 'book' ->> 'title', 'Buddy Dune', 'with its Book');
select is(jsonb_array_length(:'v'::jsonb -> 'sections'), 5, 'four parts and the end');
select is(:'v'::jsonb -> 'sections' -> 4 ->> 'kind', 'end', 'the end last');
select is(tests.keys(:'v'::jsonb -> 'sections' -> 0),
  array['count', 'end_page', 'id', 'kind', 'label', 'position', 'start_page', 'to_fraction', 'unread'], 'a Section''s shape');
select is(tests.keys(tests.card(:'v', :'hana')), array['id', 'name', 'photo', 'role', 'where'],
  'a member''s card: name, photo, role, where; no page, percent, fraction, date or entry');
select is(tests.card(:'v', :'hana') -> 'where', '{"kind": "section", "section": 1}'::jsonb, 'with her copy linked, she is in Section 1');
select is(tests.keys(:'v'::jsonb -> 'me'), array['auto', 'entry_id', 'hand', 'read_through', 'where'], 'her own place, to herself');
select ok(tests.has(:'v'::jsonb -> 'invited', :'ivo') and tests.has(:'v'::jsonb -> 'invited', :'jo'), 'the host sees who is invited');
select is(:'v'::jsonb ->> 'link_token', :'t_a', 'and the link');

-- ------------------------------------------------------------------------- invitations (38)

select tests.act_as(:'ivo');
select ok(tests.listed(public.my_buddy_reads() -> 'invitations', :'r_a') is not null, 'Ivo sees his invitation');
select is(tests.listed(public.my_buddy_reads() -> 'invitations', :'r_a') -> 'invited_by' ->> 'id', :'hana', 'from Hana');
select throws_ok(format($$ select public.buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'an invitation does not open the read');
select lives_ok(format($$ select public.answer_buddy_invite('%s', true) $$, :'r_a'), 'he accepts');
select public.buddy_read(:'r_a') as v \gset
select ok(not (:'v'::jsonb ->> 'can_manage')::boolean and :'v'::jsonb ->> 'role' = 'member', 'and is a member, who does not manage it');
select ok(:'v'::jsonb -> 'link_token' = 'null'::jsonb and :'v'::jsonb -> 'invited' = 'null'::jsonb, 'nor sees the link or the invitations');
select is(tests.card(:'v', :'ivo') -> 'where', '{"kind": "not_set"}'::jsonb, 'his Section is not set: no copy, no hand');
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array['%s']::uuid[]) $$, :'r_a', :'kim'),
  'PT403', 'not_host', 'a member cannot invite');
select throws_ok(format($$ select public.answer_buddy_invite('%s', true) $$, :'r_a'), 'PT404', 'not_found', 'an answered invitation is gone');

select tests.act_as(:'jo');
select lives_ok(format($$ select public.answer_buddy_invite('%s', false) $$, :'r_a'), 'Jo declines');
select ok(tests.listed(public.my_buddy_reads() -> 'invitations', :'r_a') is null and tests.member_row(:'r_a', :'jo') is null,
  'and her invitation is gone');

select tests.act_as(:'tom');
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array['%s']::uuid[]) $$, :'r_a', :'kim'),
  'PT404', 'not_found', 'a stranger is told there is no such read, not that he is not its host');
select throws_ok(format($$ select public.buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'nor can he open it');
select throws_ok(format($$ select public.set_buddy_hand('%s', 1) $$, :'r_a'), 'PT404', 'not_found', 'or set a Section in it');
select throws_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'or leave it');
select throws_ok(format($$ select public.finish_buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'or finish it');
select throws_ok($$ select public.buddy_read(gen_random_uuid()) $$, 'PT404', 'not_found', 'the same as for a read that does not exist');

-- ------------------------------------------------------------------------- the link (39, 40)

select tests.act_as(:'kim');
select public.buddy_read_target(:'t_a') as v \gset
select is(tests.keys(:'v'), array['book', 'host', 'id', 'member_count', 'members', 'sections', 'starts_on', 'state'], 'the join card');
select ok(:'v'::jsonb ->> 'state' = 'none' and (:'v'::jsonb ->> 'member_count')::int = 2 and (:'v'::jsonb ->> 'sections')::int = 4,
  'two members, four parts, and Kim is not in it');
select is(public.join_buddy_read(:'t_a') ->> 'id', :'r_a', 'Kim joins by the link');
select is(public.join_buddy_read(:'t_a') ->> 'id', :'r_a', 'again: the same answer (40)');
select is(tests.calls(:'kim', 'join'), 1, 'and the second join counted no call');
select is(
  (select count(*)::int from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid()
      and ((l.classid::bigint << 32) | l.objid::bigint) in (hashtextextended('buddy:' || :'kim', 0),
                                                             hashtextextended('buddy_read:' || :'r_a', 0))),
  2, 'the join took her member lock and the read''s lock (37: the cap is counted under it)');
select is(public.buddy_read_target(:'t_a') ->> 'state', 'member', 'the card knows she is in');

select tests.act_as(:'ivo');
select throws_ok(format($$ select public.buddy_read_link('%s', true) $$, :'r_a'), 'PT403', 'not_host', 'a member cannot change the link');

select tests.act_as(:'hana');
select public.buddy_read_link(:'r_a', true, true) as t_a2 \gset
select ok(:'t_a2' ~ '^[A-Za-z0-9_-]{22}$' and :'t_a2' <> :'t_a', 'renewing makes a new token');
select is(public.buddy_read_link(:'r_a', true), :'t_a2', 'turning it on again keeps it');

-- The same null for every bad token (39).
select tests.act_as(:'lu');
select is(public.buddy_read_target(:'t_a'), null, 'a renewed token answers null');
select ok(public.buddy_read_target(:'t_a2') is not null, 'the new one opens');
select is(public.buddy_read_target('AAAAAAAAAAAAAAAAAAAAAA'), null, 'a wrong token answers null');
select is(public.buddy_read_target('not a token'), null, 'a malformed one too');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a'), 'PT404', 'not_found', 'and joining by the old one is not_found');
select throws_ok($$ select public.join_buddy_read('AAAAAAAAAAAAAAAAAAAAAA') $$, 'PT404', 'not_found', 'as by a wrong one');
select tests.act_as(:'hana');
select is(public.buddy_read_link(:'r_a', false), null, 'the host turns the link off');
select tests.act_as(:'lu');
select is(public.buddy_read_target(:'t_a2'), null, 'an off link answers null');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a2'), 'PT404', 'not_found', 'and does not let her in');
select tests.act_as(:'hana');
select public.buddy_read_link(:'r_a', true) as t_a3 \gset
select tests.block(:'ivo', :'kim');
select tests.act_as(:'kim');
select is(public.join_buddy_read(:'t_a3') ->> 'id', :'r_a', 'a member already in joins again idempotently, even blocked since');
select tests.unblock(:'ivo', :'kim');

-- A block with any member: Ivo blocked Vic, whom Hana follows.
select tests.follow(:'hana', :'vic');
select tests.block(:'ivo', :'vic');
select tests.act_as(:'vic');
select is(public.buddy_read_target(:'t_a3'), null, 'a visitor blocked by any member gets the same null');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a3'), 'PT404', 'not_found', 'and cannot join (40)');
select tests.act_as(:'hana');
select is(public.invite_to_buddy_read(:'r_a', array[:'vic']::uuid[]) -> 'skipped', jsonb_build_array(:'vic'),
  'nor can the host invite him (Vic is skipped)');
select tests.unblock(:'ivo', :'vic');

-- ------------------------------------------------------------------------- the cap of 12 (37)

select tests.act_as(:'hana');
select public.invite_to_buddy_read(:'r_h',
  array[:'ivo', :'jo', :'kim', :'lu', :'max', :'ned', :'ola', :'pat', :'quin', :'rae', :'sam']::uuid[]) as v \gset
select is(jsonb_array_length(:'v'::jsonb -> 'invited'), 11, 'Hana invites eleven');
select is(tests.rows_of(:'r_h'), 12, 'twelve rows, eleven of them waiting');
select tests.follow(:'hana', :'tom');
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array(select gen_random_uuid() from generate_series(1, 13))) $$, :'r_h'),
  'PT409', 'buddy_read_full', 'a list longer than a read can hold is refused before it is read');
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array['%s']::uuid[]) $$, :'r_h', :'tom'),
  'PT409', 'buddy_read_full', 'a thirteenth invitation is refused: waiting invitations count');
select public.buddy_read_link(:'r_h', true) as t_h \gset
select tests.act_as(:'wes');
select is(public.buddy_read_target(:'t_h'), null, 'a full read''s link answers null');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_h'), 'PT409', 'buddy_read_full', 'and joining it is refused as full');
select tests.act_as(:'ivo');
select is(public.buddy_read_target(:'t_h') ->> 'state', 'invited', 'an invited member still opens it');
select is(public.join_buddy_read(:'t_h') ->> 'id', :'r_h', 'and joining by the link takes her invitation');
select tests.act_as(:'sam');
select lives_ok(format($$ select public.answer_buddy_invite('%s', false) $$, :'r_h'), 'Sam declines');
select tests.act_as(:'wes');
select ok(public.buddy_read_target(:'t_h') is not null, 'a place is free again');
select is(public.join_buddy_read(:'t_h') ->> 'id', :'r_h', 'and Wes takes it');
select is(tests.rows_of(:'r_h'), 12, 'twelve again');

-- ------------------------------------------------------------------------- rate limits and the 10-read limit (45)

select tests.fill_calls(:'hana', 'create', 20);
select tests.act_as(:'hana');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_ilium'),
  'PT429', 'rate_limited', 'the 21st create in an hour is refused');
select tests.fill_calls(:'hana', 'invite', 20);
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array['%s']::uuid[]) $$, :'r_a', :'lu'),
  'PT429', 'rate_limited', 'the 21st invite in an hour is refused');
select tests.clear_calls(:'hana');
select tests.fill_calls(:'lu', 'join', 30);
select tests.act_as(:'lu');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a3'), 'PT429', 'rate_limited', 'the 31st join in an hour is refused');
select tests.clear_calls(:'lu');

select tests.fill_old_calls(:'tom', 'create', 25);
select tests.act_as(:'tom');
select ok(public.create_buddy_read(:'b_tom', gen_random_uuid(), tests.secs(3)) ->> 'id' is not null,
  'calls older than an hour do not count');
select is(tests.calls(:'tom', 'create'), 1, 'they are purged, and this call is the one row left');
select tests.fill_calls(:'tom', 'create', 19);
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_tom2'),
  'PT429', 'rate_limited', 'at twenty in the hour the next is refused');
select is(tests.calls(:'tom', 'create'), 20, 'and a refused call leaves no row');

select tests.in_reads(:'pat', :'b_dune', 10);
select tests.act_as(:'pat');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_pat'),
  'PT429', 'buddy_read_limit', 'a member in ten active reads cannot start an eleventh');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a3'), 'PT429', 'buddy_read_limit', 'nor join one');
select throws_ok(format($$ select public.answer_buddy_invite('%s', true) $$, :'r_h'), 'PT429', 'buddy_read_limit', 'nor accept one');

-- ------------------------------------------------------------------------- where she is: hand, copy, Sections

select tests.act_as(:'ivo');
select is(public.set_buddy_hand(:'r_a', 2) -> 'where', '{"kind": "section", "section": 3}'::jsonb,
  'two parts read by hand: she is in Section 3');
select tests.act_as(:'hana');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo'), (
    select jsonb_build_object('id', :'ivo'::uuid, 'name', 'Ivo', 'photo', null, 'role', 'member',
                              'where', jsonb_build_object('kind', 'section', 'section', 3))),
  'the host sees Section 3 and nothing else of it');
select tests.block(:'kim', :'ivo');
select tests.act_as(:'kim');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo'),
  jsonb_build_object('id', :'ivo'::uuid, 'name', 'Ivo', 'photo', null, 'role', 'member', 'where', null),
  'Kim blocked Ivo: she sees his card, and no Section of his');
select is(tests.card(public.buddy_read(:'r_a'), :'hana') -> 'where', '{"kind": "section", "section": 1}'::jsonb,
  'the others'' Sections she still sees');
select tests.act_as(:'ivo');
select is(tests.card(public.buddy_read(:'r_a'), :'kim') -> 'where', 'null'::jsonb, 'and Ivo, blocked, sees none of hers');
select is(public.buddy_read(:'r_a') -> 'me' -> 'where', '{"kind": "section", "section": 3}'::jsonb, 'his own he still sees');
select tests.act_as(:'hana');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', '{"kind": "section", "section": 3}'::jsonb,
  'the host, blocked by neither, sees his Section as before');
select tests.unblock(:'kim', :'ivo');
select tests.act_as(:'kim');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', '{"kind": "section", "section": 3}'::jsonb,
  'the block lifted, Kim sees it again');
select tests.act_as(:'ivo');
select is(public.set_buddy_hand(:'r_a', 4) -> 'where', '{"kind": "end"}'::jsonb, 'every part read: the end');
select throws_ok(format($$ select public.set_buddy_hand('%s', 5) $$, :'r_a'), '22023', 'buddy_position_invalid', 'more parts than there are is refused');
select throws_ok(format($$ select public.set_buddy_hand('%s', -1) $$, :'r_a'), '22023', 'buddy_position_invalid', 'as is less than none');
select is(public.set_buddy_hand(:'r_a', null) -> 'where', '{"kind": "not_set"}'::jsonb, 'cleared, with no copy: not set');
select is(public.link_buddy_entry(:'r_a', :'e_ivo_dune') ->> 'entry_id', :'e_ivo_dune', 'another edition of the same work can be his copy');
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', '{"kind": "section", "section": 1}'::jsonb, 'and puts him in Section 1');
select throws_ok(format($$ select public.link_buddy_entry('%s', '%s') $$, :'r_a', :'e_ivo_other'),
  '22023', 'buddy_entry_invalid', 'another Book cannot');
select throws_ok(format($$ select public.link_buddy_entry('%s', '%s') $$, :'r_a', :'e_dune'),
  '22023', 'buddy_entry_invalid', 'nor someone else''s entry');
select is(public.link_buddy_entry(:'r_a', null) -> 'entry_id', 'null'::jsonb, 'null unlinks it');
select throws_ok(format($$ select public.set_buddy_sections('%s', tests.secs(3)) $$, :'r_a'), 'PT403', 'not_host', 'a member cannot change the Sections');
select public.set_buddy_hand(:'r_a', 4);

select tests.act_as(:'hana');
select tests.section_ids(:'r_a') as ids_before \gset
select is(public.set_buddy_sections(:'r_a', tests.secs(4, 'Part')) -> 'sections' -> 0 ->> 'label', 'Part 1', 'the host renames the Sections');
select is(tests.section_ids(:'r_a')::text, :'ids_before', 'a rename keeps every Section');
select public.set_buddy_sections(:'r_a', tests.secs(2));
select ok(cardinality(tests.section_ids(:'r_a')) = 3 and not (tests.section_ids(:'r_a') && :'ids_before'::uuid[]),
  'another division replaces them');
select is(tests.member_row(:'r_a', :'ivo') ->> 'hand_through', '2', 'and a hand-set Section is held to the new number of parts');
select tests.set_auto(:'r_a', :'ivo', 4::smallint);
select is(tests.card(public.buddy_read(:'r_a'), :'ivo') -> 'where', '{"kind": "end"}'::jsonb,
  'parts read beyond the new number (from progress, D2) show the end, not a Section that is not there');
select tests.set_auto(:'r_a', :'ivo', null);
select is(jsonb_array_length(public.set_buddy_sections(:'r_a', tests.secs(100)) -> 'sections'), 101, 'a hundred parts are allowed');
select public.set_buddy_sections(:'r_a', tests.secs(4));
select throws_ok(format($$ select public.set_buddy_sections('%s', '[]') $$, :'r_a'), '22023', 'buddy_sections_invalid', 'a bad list is refused');

-- ------------------------------------------------------------------------- photos: co-members (43)

select tests.act_as(:'bo');
select public.create_buddy_read(:'b_bo', gen_random_uuid(), tests.secs(3), array[:'fay']::uuid[], true) as v \gset
select (:'v'::jsonb ->> 'id') as r_p, (:'v'::jsonb ->> 'link_token') as t_p \gset
select tests.act_as(:'cal');
select ok(not public.can_see_member_photo(:'dee') and not public.can_see_member_folder(:'dee'),
  'before, Cal cannot see Dee''s photo (no follow, no link)');
select public.join_buddy_read(:'t_p');
select tests.act_as(:'dee');
select public.join_buddy_read(:'t_p');
select ok(public.can_see_member_photo(:'cal') and public.can_see_member_folder(:'cal'), 'in one read, Dee sees Cal''s photo');
select tests.act_as(:'cal');
select ok(public.can_see_member_photo(:'dee') and public.can_see_member_folder(:'dee'), 'and Cal sees Dee''s, the storage policy''s way too');
select tests.act_as(:'fay');
select ok(not public.can_see_member_photo(:'cal'), 'an invitation alone shows nobody''s photo');
select tests.block(:'cal', :'fay');
select ok(tests.listed(public.my_buddy_reads() -> 'invitations', :'r_p') is null, 'blocked by a member, Fay no longer sees the invitation');
select throws_ok(format($$ select public.answer_buddy_invite('%s', true) $$, :'r_p'), 'PT404', 'not_found', 'nor can she accept it');
select tests.unblock(:'cal', :'fay');
select tests.block(:'dee', :'cal');
select tests.act_as(:'cal');
select ok(not public.can_see_member_photo(:'dee') and not public.can_see_member_folder(:'dee'), 'a block hides it, both ways');
select tests.act_as(:'dee');
select ok(not public.can_see_member_photo(:'cal'), 'from her side too');
select tests.unblock(:'dee', :'cal');
select public.leave_buddy_read(:'r_p');
select tests.act_as(:'cal');
select ok(not public.can_see_member_photo(:'dee') and not public.can_see_member_folder(:'dee'), 'once she left, it is gone');
select tests.act_as(:'bo');
select public.finish_buddy_read(:'r_p');
select tests.act_as(:'cal');
select ok(public.can_see_member_photo(:'bo'), 'a finished read still shows its members'' photos to each other');

-- ------------------------------------------------------------------------- remove

select tests.act_as(:'ivo');
select throws_ok(format($$ select public.remove_from_buddy_read('%s', '%s') $$, :'r_a', :'kim'), 'PT403', 'not_host', 'a member cannot remove');
select tests.act_as(:'hana');
select throws_ok(format($$ select public.remove_from_buddy_read('%s', '%s') $$, :'r_a', :'hana'),
  '22023', 'buddy_remove_self', 'the host leaves, she does not remove herself');
select lives_ok(format($$ select public.remove_from_buddy_read('%s', '%s') $$, :'r_a', :'kim'), 'the host removes Kim');
select ok(not tests.has(public.buddy_read(:'r_a') -> 'members', :'kim'), 'Kim is no longer listed');
select lives_ok(format($$ select public.remove_from_buddy_read('%s', '%s') $$, :'r_a', :'kim'), 'removing her again does nothing');
select tests.act_as(:'kim');
select throws_ok(format($$ select public.buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'and she cannot open it');
select is(public.buddy_read_target(:'t_a3'), null, 'the link answers her the same null as any bad link');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_a3'), 'PT404', 'not_found',
  'and does not let her back in: a removal sticks');
select tests.act_as(:'hana');
select ok(public.invite_to_buddy_read(:'r_a', array[:'kim']::uuid[]) -> 'invited' @> jsonb_build_array(:'kim'),
  'the host invites her again');
select ok(not tests.removed(:'r_a', :'kim'), 'which clears the removal');
select tests.act_as(:'kim');
select is(public.buddy_read_target(:'t_a3') ->> 'state', 'invited', 'the link opens for her again');
select is(public.join_buddy_read(:'t_a3') ->> 'id', :'r_a', 'and she joins');
select public.leave_buddy_read(:'r_a');

-- ------------------------------------------------------------------------- finish and archive

select tests.act_as(:'ivo');
select throws_ok(format($$ select public.finish_buddy_read('%s') $$, :'r_h'), 'PT403', 'not_host', 'a member cannot finish');
select throws_ok(format($$ select public.archive_buddy_read('%s') $$, :'r_h'), 'PT403', 'not_host', 'nor archive');
select tests.act_as(:'hana');
select public.remove_from_buddy_read(:'r_h', :'rae');
select tests.act_as(:'tom');
select ok(public.buddy_read_target(:'t_h') is not null, 'with a place free, Tom could open the link');
select tests.act_as(:'hana');
select lives_ok(format($$ select public.finish_buddy_read('%s') $$, :'r_h'), 'the host finishes');
select ok(public.buddy_read(:'r_h') ->> 'status' = 'finished' and public.buddy_read(:'r_h') ->> 'finished_at' is not null, 'it is finished');
select throws_ok(format($$ select public.invite_to_buddy_read('%s', array['%s']::uuid[]) $$, :'r_h', :'tom'),
  'PT409', 'buddy_read_ended', 'a finished read takes no invitations');
select throws_ok(format($$ select public.buddy_read_link('%s', true) $$, :'r_h'), 'PT409', 'buddy_read_ended', 'nor a link');
select tests.act_as(:'tom');
select is(public.buddy_read_target(:'t_h'), null, 'once it is finished, its link answers the same null');
select throws_ok(format($$ select public.join_buddy_read('%s') $$, :'t_h'), 'PT404', 'not_found', 'and lets nobody in');
select tests.act_as(:'hana');
select ok(public.create_buddy_read(:'b_hyp', gen_random_uuid(), tests.secs(2)) ->> 'id' <> :'r_h',
  'with it finished, Hana may start another read of the Book');
select lives_ok(format($$ select public.archive_buddy_read('%s') $$, :'r_h'), 'the host archives it');
select is(tests.listed(public.my_buddy_reads() -> 'reads', :'r_h') ->> 'status', 'archived', 'it is listed as archived');
select throws_ok(format($$ select public.set_buddy_sections('%s', tests.secs(3)) $$, :'r_h'), 'PT409', 'buddy_read_archived', 'an archived read is read only');
select throws_ok(format($$ select public.finish_buddy_read('%s') $$, :'r_h'), 'PT409', 'buddy_read_archived', 'and cannot be finished again');
select tests.act_as(:'ivo');
select throws_ok(format($$ select public.set_buddy_hand('%s', 1) $$, :'r_h'), 'PT409', 'buddy_read_archived', 'nor take a Section');
select throws_ok(format($$ select public.link_buddy_entry('%s', null) $$, :'r_h'), 'PT409', 'buddy_read_archived', 'nor change a copy');

-- ------------------------------------------------------------------------- my_buddy_reads

select tests.act_as(:'ivo');
select tests.listed(public.my_buddy_reads() -> 'reads', :'r_a') as v \gset
select is(tests.keys(:'v'), array['book', 'id', 'member_count', 'role', 'sections', 'starts_on', 'status', 'unread', 'where'],
  'a read in her list');
select ok(:'v'::jsonb ->> 'role' = 'member' and (:'v'::jsonb ->> 'member_count')::int = 2
          and :'v'::jsonb -> 'where' = '{"kind": "section", "section": 3}'::jsonb, 'with her role, how many are in it and her own Section');

select tests.in_ended_reads(:'rae', :'b_dune', 22);
select tests.act_as(:'rae');
select is((select count(*)::int from jsonb_array_elements(public.my_buddy_reads() -> 'reads') r where r ->> 'status' <> 'active'),
  20, 'her list holds the 20 reads that ended last, not all 22');

-- ------------------------------------------------------------------------- leaving (41)

select tests.act_as(:'lu');
select public.join_buddy_read(:'t_a3');
select tests.act_as(:'hana');
select lives_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_a'), 'the host leaves');
select is(tests.read_row(:'r_a') ->> 'host_id', :'ivo', 'Ivo, who joined first, is host');
select tests.act_as(:'ivo');
select ok((public.buddy_read(:'r_a') ->> 'can_manage')::boolean and tests.card(public.buddy_read(:'r_a'), :'ivo') ->> 'role' = 'host',
  'and manages it');
select tests.act_as(:'hana');
select throws_ok(format($$ select public.buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'Hana is out');
select throws_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_a'), 'PT404', 'not_found', 'and cannot leave twice');
select tests.act_as(:'ivo');
select public.leave_buddy_read(:'r_a');
select is(tests.read_row(:'r_a') ->> 'host_id', :'lu', 'then Lu');
select tests.act_as(:'lu');
select lives_ok(format($$ select public.leave_buddy_read('%s', true) $$, :'r_a'), 'the last member leaves');
select is(tests.read_row(:'r_a'), null, 'and the read is gone (42: no row of it is left)');
select is(tests.rows_of(:'r_a'), 0, 'with its invitations and members');

-- Gus leaves; Hal, the heir, hosts a read of the same Book already.
select tests.act_as(:'gus');
select public.create_buddy_read(:'b_gus', gen_random_uuid(), tests.secs(3), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_g, (:'v'::jsonb ->> 'link_token') as t_g \gset
select tests.act_as(:'hal');
select public.create_buddy_read(:'b_gus', gen_random_uuid(), tests.secs(3)) ->> 'id' as r_hal \gset
select public.join_buddy_read(:'t_g');
select tests.act_as(:'gus');
select lives_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_g'), 'the host leaves, to an heir who hosts the same Book');
select ok(tests.member_row(:'r_g', :'hal') ->> 'role' = 'host' and tests.read_row(:'r_g') -> 'host_id' = 'null'::jsonb,
  'Hal is host by his row, host_id stays null');
select tests.act_as(:'hal');
select public.finish_buddy_read(:'r_hal');
select throws_ok(format($$ select public.create_buddy_read('%s', gen_random_uuid(), tests.secs(3)) $$, :'b_gus'),
  'PT409', 'buddy_read_exists', 'a host by row still has her one active read of the Book');
select tests.act_as(:'ola');
select public.join_buddy_read(:'t_g');
select tests.act_as(:'hal');
select lives_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_g'), 'the host by row leaves');
select ok(tests.member_row(:'r_g', :'ola') ->> 'role' = 'host' and tests.read_row(:'r_g') ->> 'host_id' = :'ola',
  'and hands the read on: Ola is host, host_id hers');

-- ------------------------------------------------------------------------- account deletion (44)

select tests.act_as(:'xan');
select public.create_buddy_read(:'b_xan', gen_random_uuid(), tests.secs(3), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_x, (:'v'::jsonb ->> 'link_token') as t_x \gset
select tests.act_as(:'yul');
select public.create_buddy_read(:'b_xan', gen_random_uuid(), tests.secs(3)) ->> 'id' as r_yul \gset
select public.join_buddy_read(:'t_x');
select tests.act_as(:'zed');
select public.join_buddy_read(:'t_x');
select tests.act_as(:'xan');
select lives_ok($$ select public.delete_my_account() $$, 'the host deletes her account, although her heir hosts a read of that Book');
select is(tests.member_row(:'r_x', :'yul') ->> 'role', 'host', 'Yul, who joined first, is host');
select is(tests.read_row(:'r_x') -> 'host_id', 'null'::jsonb, 'by her row only: one active read per host and Book still holds');
select is(tests.rows_of(:'r_x'), 2, 'and the read goes on with two');
select tests.act_as(:'yul');
select ok((public.buddy_read(:'r_x') ->> 'can_manage')::boolean, 'she manages it');
select tests.act_as(:'zed');
select lives_ok($$ select public.delete_my_account() $$, 'a member who is not the host deletes her account');
select ok(tests.rows_of(:'r_x') = 1 and tests.member_row(:'r_x', :'yul') ->> 'role' = 'host', 'she is gone from the read, its host stays');
select tests.act_as(:'quin');
select public.join_buddy_read(:'t_x');
select tests.act_as(:'yul');
select lives_ok($$ select public.delete_my_account() $$, 'Yul, host by her row with host_id null, deletes her account');
select ok(tests.member_row(:'r_x', :'quin') ->> 'role' = 'host' and tests.read_row(:'r_x') ->> 'host_id' = :'quin',
  'Quin is host, host_id his');
select is(tests.read_row(:'r_yul'), null, 'and Yul''s own read, with nobody else in it, is gone');

select tests.act_as(:'ari');
select public.create_buddy_read(:'b_ari', gen_random_uuid(), tests.secs(3), array[:'bo']::uuid[]) ->> 'id' as r_y \gset
select is(tests.rows_of(:'r_y'), 2, 'Ari alone, and Bo invited');
select lives_ok($$ select public.delete_my_account() $$, 'Ari deletes her account');
select is(tests.read_row(:'r_y'), null, 'her read, with nobody else in it, is gone');
select is(tests.rows_of(:'r_y'), 0, 'Bo''s invitation with it');

-- ------------------------------------------------------------------------- follower-facing functions show no progress

select tests.act_as(:'hana');
select public.create_buddy_read(:'b_dune', gen_random_uuid(), tests.secs(4)) ->> 'id' as r_d \gset
select public.set_buddy_hand(:'r_d', 2);
select public.start_reading(:'e_dune', current_date - 3);
select public.update_progress(:'e_dune', 120, null, true, 400);
select tests.act_as(:'wes');
select ok(public.member_profile(:'hana')::text !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'her follower''s view of her profile carries no progress and nothing of her buddy read');
select ok(coalesce(public.feed()::text, '') !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'nor the feed');
select ok(coalesce(public.both_read(:'hana')::text, '') !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'nor both_read');
select ok(coalesce(public.member_reading_record(:'hana')::text, '') !~ '(read_through|hand_through|auto_through|progress_page|progress_percent|buddy)',
  'nor her reading record');
reset role;
select is(
  (select count(*)::int from unnest(array[
      'private.member_card(uuid, uuid)', 'public.member_profile(uuid)', 'public.feed(timestamptz, uuid, integer)',
      'public.both_read(uuid, integer)', 'public.member_reading_record(uuid)', 'public.public_reading_page(text)',
      'public.public_book_card(text, uuid)', 'public.book_readers(uuid, jsonb, integer)'
    ]) f where pg_get_functiondef(f::regprocedure) ~ 'buddy'),
  0, 'and none of the follower-facing functions reads a buddy read');

select * from finish();
rollback;
