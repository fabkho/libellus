-- Notes on a Book, N1: who sees a note (migration 20261116010000_book_notes.sql; docs/plans/book-notes.md
-- part 2.3, brief docs/plans/book-notes/briefs/N1-database.md, pgTAP items 1 to 4 and 9):
--   supabase test db
--
-- The matrix: three notes of A's (Only me, Friends, Everyone) x Everyone on and off x eight members and
-- nobody signed in, through private.can_see_note, private.visible_notes (which must agree with it on every
-- row of this file's fixture), note_messages, book_notes (counts and faces) and notes_summary. Then
-- replies (never wider than the note they answer, the quote of a note she cannot see, the split thread of
-- plan 2.3.2), changing a note's level (narrowing cascades, widening is bounded), counts that never count
-- what the reader cannot see, reactions across a block, and the grants. Rules of chapters, her chapter,
-- moderation, the two shipped functions and account deletion: book_notes_rules_test.sql.
--
-- Fixture members: A (author), F (A and F follow each other, accepted), O1 (A follows O1 only), O2 (O2
-- follows A only), P (P asked to follow A, not accepted), S (a member, no relation), B1 (A blocked B1),
-- B2 (B2 blocked A); for the replies Jo (A's friend, not F's) and Mira (no relation). Assertions ask
-- about rows this test made, never counts of a table.

begin;
select plan(198);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-NOTES-1', 'book notes test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-NOTES-1', 'name', p_name)), now(), now(), now());
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

-- A Catalogue Book's snapshot; the same title is the same Book.
create or replace function tests.snap(p_title text, p_pages integer default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9830000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'page_count', p_pages))
$$;

create or replace function tests.follow(p_follower uuid, p_followee uuid, p_accepted boolean default true)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at)
  values (p_follower, p_followee, case when p_accepted then now() end)
  on conflict (follower_id, followee_id) do update set accepted_at = excluded.accepted_at, declined_at = null
$$;
create or replace function tests.decline(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at, declined_at) values (p_follower, p_followee, null, now())
  on conflict (follower_id, followee_id) do update set accepted_at = null, declined_at = now()
$$;
create or replace function tests.block(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;
create or replace function tests.unblock(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  delete from public.blocks where blocker_id = p_blocker and blocked_id = p_blocked
$$;
create or replace function tests.switch(p_on boolean)
returns void language sql security definer as $$
  update private.notes_settings set public_enabled = p_on
$$;
-- Ties a Book to a Work (a new one when p_work is null) the way the catalogue does; answers the work id.
create or replace function tests.tie(p_book uuid, p_work uuid, p_by text)
returns uuid language plpgsql security definer as $$
declare v_work uuid := p_work;
begin
  if v_work is null then
    insert into public.works (wikidata_id, title) values ('Q9' || (random() * 1e9)::bigint, 'A work ' || p_book) returning id into v_work;
  end if;
  insert into public.book_works (book_id, work_id, matched_by) values (p_book, v_work, p_by)
  on conflict (book_id) do update set work_id = excluded.work_id, matched_by = excluded.matched_by;
  return v_work;
end;
$$;
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$
  select book_id from public.library_entries where id = p_entry
$$;
create or replace function tests.sec(p_room uuid, p_position integer)
returns uuid language sql security definer as $$
  select id from public.room_sections where room_id = p_room and position = p_position
$$;
create or replace function tests.vis(p_note uuid)
returns text language sql security definer as $$
  select visibility from public.room_messages where id = p_note
$$;
-- A note as the acting member; answers its id.
create or replace function tests.note(p_room uuid, p_section uuid, p_body text, p_visibility text,
                                      p_reply_to uuid default null)
returns uuid language sql as $$
  select (public.post_note(p_room, p_section, gen_random_uuid(), p_body, p_visibility, p_reply_to) ->> 'id')::uuid
$$;
-- The ids of a list, sorted.
create or replace function tests.ids(p jsonb, p_key text default 'id')
returns uuid[] language sql as $$
  select coalesce(array_agg((x ->> p_key)::uuid order by (x ->> p_key)::uuid), '{}') from jsonb_array_elements(p) x
$$;
create or replace function tests.sorted(p uuid[])
returns uuid[] language sql as $$
  select coalesce(array_agg(x order by x), '{}') from unnest(p) x where x is not null
$$;
create or replace function tests.in_page(p_page jsonb, p_note uuid)
returns jsonb language sql as $$
  select m from jsonb_array_elements(p_page) m where m ->> 'id' = p_note::text
$$;
create or replace function tests.chapter(p_page jsonb, p_position integer)
returns jsonb language sql as $$
  select c from jsonb_array_elements(p_page -> 'room' -> 'chapters') c where (c ->> 'position')::int = p_position
$$;

-- The fixture's names, for the functions below.
create table tests.fx (tag text primary key, id uuid);
grant usage on schema tests to authenticated, anon;
grant select on tests.fx to authenticated;
grant execute on all functions in schema tests to authenticated;
create or replace function tests.id(p_tag text) returns uuid language sql as $$ select id from tests.fx where tag = p_tag $$;

-- ------------------------------------------------------------------------- the fixture

select tests.member('a@notes.test', 'Anna A') as a \gset
select tests.member('f@notes.test', 'Ben F') as f \gset
select tests.member('o1@notes.test', 'Olga O1') as o1 \gset
select tests.member('o2@notes.test', 'Otto O2') as o2 \gset
select tests.member('p@notes.test', 'Paul P') as p \gset
select tests.member('s@notes.test', 'Sara S') as s \gset
select tests.member('b1@notes.test', 'Bert B1') as b1 \gset
select tests.member('b2@notes.test', 'Bea B2') as b2 \gset
select tests.member('jo@notes.test', 'Jo J') as jo \gset
select tests.member('mira@notes.test', 'Mira M') as mira \gset

select tests.follow(:'a', :'f'), tests.follow(:'f', :'a');
select tests.follow(:'a', :'o1');
select tests.follow(:'o2', :'a');
select tests.follow(:'p', :'a', false);
select tests.block(:'a', :'b1');
select tests.block(:'b2', :'a');
select tests.follow(:'a', :'jo'), tests.follow(:'jo', :'a');
-- Dec: A follows Dec (accepted), Dec's request to A was declined.
select tests.member('dec@notes.test', 'Dec D') as dec \gset
select tests.follow(:'a', :'dec');
select tests.decline(:'dec', :'a');

-- A has the Book; it is tied to its Work by Open Library. Ten chapters.
select tests.act_as(:'a');
select (public.add_to_library(tests.snap('The Notes Book', 384))).id as a_entry \gset
reset role;
select tests.book_of(:'a_entry') as book \gset
select tests.tie(:'book', null, 'openlibrary') as work \gset
select tests.act_as(:'a');
select (public.set_book_chapters(:'book', 10) -> 'room' ->> 'id') as room \gset
reset role;
-- F, Jo, Mira and S have the Book too (writing needs it); the others have not.
select tests.act_as(x), public.add_to_library(tests.snap('The Notes Book', 384))
  from unnest(array[:'f', :'jo', :'mira', :'s']::uuid[]) x;
reset role;
-- Every one of them reads chapters 1..10 (her hand: a reader without the Book sees no chapter open).
select tests.act_as(x), public.set_note_chapter(:'room', 10)
  from unnest(array[:'a', :'f', :'o1', :'o2', :'p', :'s', :'b1', :'b2', :'jo', :'mira']::uuid[]) x;
reset role;

-- Everyone is off after the migration (safe by default); the owner turns it on. Both are covered below.
select is(private.notes_public_enabled(), false, 'Everyone is off after the migration');
select tests.switch(true);

-- A's three notes in chapter 1.
select tests.act_as(:'a');
select tests.note(:'room', tests.sec(:'room', 1), 'Only for me', 'private') as n_priv \gset
select tests.note(:'room', tests.sec(:'room', 1), 'For my friends', 'friends') as n_fr \gset
select tests.note(:'room', tests.sec(:'room', 1), 'For everyone', 'public') as n_pub \gset
reset role;

insert into tests.fx values ('A', :'a'), ('F', :'f'), ('O1', :'o1'), ('O2', :'o2'), ('P', :'p'), ('S', :'s'),
  ('B1', :'b1'), ('B2', :'b2'), ('private', :'n_priv'), ('friends', :'n_fr'), ('public', :'n_pub'),
  ('room', :'room'), ('book', :'book');

-- Plan 2.3: who sees a note at a level, with Everyone on or off.
create or replace function tests.expect(p_level text, p_viewer text, p_on boolean)
returns boolean language sql as $$
  select case p_level
           when 'private' then p_viewer = 'A'
           when 'friends' then p_viewer in ('A', 'F')
           when 'public' then p_viewer in ('A', 'F') or (p_on and p_viewer in ('O1', 'O2', 'P', 'S'))
         end
$$;

-- What a viewer gets from the functions, and what she should get.
create or replace function tests.view(p_viewer text)
returns jsonb language plpgsql as $$
declare
  v_room uuid := tests.id('room');
  v_book uuid := tests.id('book');
  v_sec  uuid := tests.sec(tests.id('room'), 1);
  v_page jsonb;
  v_msgs jsonb;
  v_sum  jsonb;
begin
  perform tests.act_as(tests.id(p_viewer));
  v_msgs := public.note_messages(v_room, v_sec);
  v_page := public.book_notes(v_book);
  v_sum := public.notes_summary(v_book);
  reset role;
  return jsonb_build_object(
    'seen', to_jsonb(tests.ids(v_msgs)),
    'count', (tests.chapter(v_page, 1) ->> 'count')::int,
    'faces', to_jsonb(tests.ids(tests.chapter(v_page, 1) -> 'faces')),
    'friends', (v_sum -> 'friends' ->> 'count')::int,
    'public', (v_sum -> 'public' ->> 'count')::int);
end;
$$;
create or replace function tests.expected(p_viewer text, p_on boolean)
returns jsonb language sql as $$
  with e as (select tests.id(l) as id from unnest(array['private', 'friends', 'public']) l
              where tests.expect(l, p_viewer, p_on))
  select jsonb_build_object(
    'seen', to_jsonb(tests.sorted(array(select id from e))),
    'count', (select count(*)::int from e),
    'faces', to_jsonb(case when exists (select 1 from e) then array[tests.id('A')] else '{}'::uuid[] end),
    'friends', case when p_viewer = 'F' then (select count(*)::int from e) else 0 end,
    'public', case when p_on and p_viewer in ('O1', 'O2', 'P', 'S') then 1 else 0 end)
$$;

-- ------------------------------------------------------------------------- 1. the matrix

-- Everyone on (set in the fixture).
select is(private.can_see_note(tests.id(v), tests.id(l)), tests.expect(l, v, true),
          format('Everyone on: %s sees A''s %s note: %s', v, l, tests.expect(l, v, true)))
  from unnest(array['A', 'F', 'O1', 'O2', 'P', 'S', 'B1', 'B2']) v
 cross join unnest(array['private', 'friends', 'public']) l;
select is(private.can_see_note(null, tests.id(l)), false, format('Everyone on: nobody signed in never sees a %s note', l))
  from unnest(array['private', 'friends', 'public']) l;
select is(tests.view(v), tests.expected(v, true),
          format('Everyone on: %s gets the same notes from note_messages, book_notes (count, faces) and notes_summary', v))
  from unnest(array['A', 'F', 'O1', 'O2', 'P', 'S', 'B1', 'B2']) v;

-- Friends means both follows accepted: one-way, pending and declined are not friends.
select is(private.mutual_friends(:'a', :'f'), true, 'friends: A and F follow each other, both accepted');
select is(private.mutual_friends(:'a', :'o1'), false, 'one way (A follows O1) is not friends');
select is(private.mutual_friends(:'a', :'o2'), false, 'one way (O2 follows A) is not friends');
select is(private.mutual_friends(:'a', :'p'), false, 'a pending request is not friends');
select is(private.mutual_friends(:'a', :'dec'), false, 'a declined request is not friends, though A follows Dec');
select is(private.can_see_note(:'dec', :'n_fr'), false, 'Dec does not see A''s friends note');
select is(private.can_see_note(:'dec', :'n_pub'), true, 'only her public one');

-- Everyone off: public notes count as friends notes.
select tests.switch(false);
select is(private.can_see_note(tests.id(v), tests.id(l)), tests.expect(l, v, false),
          format('Everyone off: %s sees A''s %s note: %s', v, l, tests.expect(l, v, false)))
  from unnest(array['A', 'F', 'O1', 'O2', 'P', 'S', 'B1', 'B2']) v
 cross join unnest(array['private', 'friends', 'public']) l;
select is(private.can_see_note(null, tests.id(l)), false, format('Everyone off: nobody signed in never sees a %s note', l))
  from unnest(array['private', 'friends', 'public']) l;
select is(tests.view(v), tests.expected(v, false),
          format('Everyone off: %s gets the same notes from note_messages, book_notes (count, faces) and notes_summary', v))
  from unnest(array['A', 'F', 'O1', 'O2', 'P', 'S', 'B1', 'B2']) v;
select tests.act_as(:'f');
select is(tests.in_page(public.note_messages(:'room', tests.sec(:'room', 1)), :'n_pub') ->> 'effectiveVisibility', 'friends',
  'Everyone off: a public note reads effectiveVisibility friends (its visibility stays public)');
reset role;
select tests.switch(true);

-- Nobody signed in can call none of it.
select tests.act_anon();
select is(tests.outcome(format('select public.note_messages(%L, %L)', :'room', tests.sec(:'room', 1))),
  '42501 permission denied for function note_messages', 'anon: note_messages is not granted');
select is(tests.outcome(format('select public.book_notes(%L)', :'book')),
  '42501 permission denied for function book_notes', 'anon: book_notes is not granted');
reset role;
-- A token without a member: not_signed_in.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select is(tests.outcome(format('select public.book_notes(%L)', :'book')), '42501 not_signed_in',
  'a token without a member: not_signed_in');
reset role;

-- ------------------------------------------------------------------------- 2. replies (plan 2.3.2)

-- Anna = A, Ben = F, Jo, Mira. Chapter 2.
select tests.sec(:'room', 2) as ch2 \gset
select tests.act_as(:'a');
select tests.note(:'room', :'ch2', 'Anna: the mother lies', 'friends') as anna \gset
select tests.act_as(:'f');
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L, %L)', :'room', :'ch2', 'Ben, wider', 'public', :'anna')),
  '22023 note_wider_than_parent', 'a reply wider than the note it answers is refused');
select tests.note(:'room', :'ch2', 'Ben: you are right', 'friends', :'anna') as ben \gset
select tests.note(:'room', :'ch2', 'Ben: just for me', 'private', :'anna') as ben_priv \gset
select is(tests.vis(:'ben_priv'), 'private', 'a reply can be narrower than the note it answers (the level is the client''s)');
select tests.act_as(:'a');
select tests.note(:'room', :'ch2', 'Anna: thank you Ben', 'friends', :'ben') as anna2 \gset
select tests.act_as(:'mira');
select tests.note(:'room', :'ch2', 'Mira: for everyone', 'public') as mira1 \gset
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L, %L)', :'room', :'ch2', 'Mira answers', 'private', :'anna')),
  '22023 reply_not_visible', 'a reply to a note she cannot see is refused');
select tests.act_as(:'jo');
select tests.note(:'room', :'ch2', 'Jo: only mine', 'private') as jo1 \gset
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L, %L)', :'room', tests.sec(:'room', 3), 'other thread', 'friends', :'anna')),
  '22023 reply_not_visible', 'a reply stays in the thread of the note it answers');
reset role;

-- The split table: Anna, Ben, Jo, Mira x the five notes.
create or replace function tests.page_ids(p_viewer uuid, p_room uuid, p_section uuid)
returns uuid[] language plpgsql as $$
declare v jsonb;
begin
  perform tests.act_as(p_viewer);
  v := public.note_messages(p_room, p_section);
  reset role;
  return tests.ids(v);
end;
$$;
select is(tests.page_ids(:'a', :'room', :'ch2'), tests.sorted(array[:'anna', :'ben', :'anna2', :'mira1']::uuid[]),
  'Anna sees her note, Ben''s reply, her answer and Mira''s public note; not Jo''s private one nor Ben''s private reply');
select is(tests.page_ids(:'f', :'room', :'ch2'), tests.sorted(array[:'anna', :'ben', :'ben_priv', :'anna2', :'mira1']::uuid[]),
  'Ben sees Anna''s note, his replies, Anna''s answer and Mira''s note');
select is(tests.page_ids(:'jo', :'room', :'ch2'), tests.sorted(array[:'anna', :'anna2', :'mira1', :'jo1']::uuid[]),
  'Jo sees Anna''s note and answer, not Ben''s reply (Ben is not her friend), Mira''s note and her own');
select is(tests.page_ids(:'mira', :'room', :'ch2'), array[:'mira1']::uuid[], 'Mira sees only her public note');

select tests.act_as(:'jo');
select tests.in_page(public.note_messages(:'room', :'ch2'), :'anna2') -> 'quote' as jo_quote \gset
select tests.in_page(public.note_messages(:'room', :'ch2'), :'anna2') ->> 'body' as jo_body \gset
select tests.act_as(:'f');
select tests.in_page(public.note_messages(:'room', :'ch2'), :'anna2') -> 'quote' as ben_quote \gset
reset role;
select is(:'jo_quote'::jsonb, '{"hidden": true}'::jsonb,
  'Jo sees Anna''s answer with the quote hidden: "A note you can''t see", never its words or author');
select is(:'jo_body'::text, 'Anna: thank you Ben', 'and Anna''s answer itself');
select is(:'ben_quote'::jsonb ->> 'id', :'ben', 'Ben sees the quote of his reply');
select is(:'ben_quote'::jsonb ->> 'excerpt', 'Ben: you are right', 'with its excerpt');
select is(:'ben_quote'::jsonb -> 'author' ->> 'id', :'f', 'and its author');

-- Mira's note, once Anna blocked Mira: gone for Anna, there for the others.
select tests.block(:'a', :'mira');
select is(:'mira1'::uuid = any(tests.page_ids(:'a', :'room', :'ch2')), false, 'Anna blocked Mira: Mira''s public note is gone for Anna');
select is(:'mira1'::uuid = any(tests.page_ids(:'f', :'room', :'ch2')), true, 'Ben still sees it');
select is(:'mira1'::uuid = any(tests.page_ids(:'jo', :'room', :'ch2')), true, 'Jo still sees it');
select is(:'anna'::uuid = any(tests.page_ids(:'mira', :'room', :'ch2')), false, 'and Anna''s notes are gone for Mira');
select tests.unblock(:'a', :'mira');

-- The trigger is the backstop: a direct insert wider than its parent, as postgres.
select is(tests.outcome(format(
  $$insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility, reply_to)
    values (%L, %L, %L, gen_random_uuid(), 'raw', 'public', %L)$$, :'room', :'ch2', :'f', :'anna')),
  '23514 note_wider_than_parent', 'trigger: a direct insert of a reply wider than its parent is refused');
select is(tests.outcome(format(
  $$insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility, reply_to)
    values (%L, %L, %L, gen_random_uuid(), 'raw', 'friends', %L)$$, :'room', tests.sec(:'room', 3), :'f', :'anna')),
  '23514 room_message_invalid: a reply stays in its thread', 'trigger: a reply in another chapter is refused');
select is(tests.outcome(format(
  $$insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility)
    values (%L, %L, %L, gen_random_uuid(), 'raw', 'members')$$, :'room', :'ch2', :'f')),
  '23514 room_message_invalid: a note is private, friends or public', 'trigger: members is not a level of a notes room');
select is(tests.outcome(format(
  $$insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility)
    values (%L, null, %L, gen_random_uuid(), 'raw', 'friends')$$, :'room', :'f')),
  '23514 room_message_invalid: a note is in a chapter', 'trigger: a note has a chapter');
select is(tests.outcome(format(
  $$update public.room_messages set visibility = 'public' where id = %L$$, :'ben')),
  '23514 note_wider_than_parent', 'trigger: a direct update widening a reply past its parent is refused');

-- A deleted parent: the quote says removed to whoever could see it.
select tests.act_as(:'f');
select tests.note(:'room', :'ch2', 'Ben: one more', 'friends', :'anna2') as ben2 \gset
select tests.act_as(:'a');
select public.delete_note(:'anna2');
select tests.act_as(:'f');
select is(tests.in_page(public.note_messages(:'room', :'ch2'), :'ben2') -> 'quote', '{"removed": true}'::jsonb,
  'the quote of a deleted note reads removed');
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L, %L)', :'room', :'ch2', 'to a tombstone', 'friends', :'anna2')),
  '22023 reply_not_visible', 'no reply to a deleted note');
reset role;

-- ------------------------------------------------------------------------- 3. changing a note's level

-- Anna's public note q; Ben answers it at Everyone, Jo answers Ben at Friends, Mira answers Ben at Everyone.
select tests.sec(:'room', 4) as ch4 \gset
select tests.act_as(:'a');
select tests.note(:'room', :'ch4', 'Anna: a public thought', 'public') as q \gset
select tests.act_as(:'f');
select tests.note(:'room', :'ch4', 'Ben: public answer', 'public', :'q') as rq \gset
select tests.act_as(:'jo');
select tests.note(:'room', :'ch4', 'Jo: friends answer', 'friends', :'rq') as rq_jo \gset
select tests.act_as(:'mira');
select tests.note(:'room', :'ch4', 'Mira: public answer', 'public', :'rq') as rq_mira \gset

-- Narrowing q to Friends narrows every wider reply, whoever wrote it, and leaves narrower ones.
select tests.act_as(:'a');
select public.set_note_visibility(:'q', 'friends') ->> 'visibility' as q_vis \gset
reset role;
select is(:'q_vis'::text, 'friends', 'narrowing answers the note at its new level');
select is(tests.vis(:'rq'), 'friends', 'narrowing: Ben''s public reply is narrowed to Friends');
select is(tests.vis(:'rq_mira'), 'friends', 'narrowing: Mira''s public reply to Ben''s reply is narrowed too (all the way down)');
select is(tests.vis(:'rq_jo'), 'friends', 'narrowing: Jo''s friends reply stays as it was');
select tests.act_as(:'a');
select public.set_note_visibility(:'q', 'private');
reset role;
select is(array[tests.vis(:'q'), tests.vis(:'rq'), tests.vis(:'rq_jo'), tests.vis(:'rq_mira')],
  array['private', 'private', 'private', 'private'], 'narrowing to Only me narrows every reply under it');
select is(tests.page_ids(:'mira', :'room', :'ch4'), array[:'rq_mira']::uuid[],
  'Mira now sees only her own reply (narrowing only ever hides)');

-- Widening: up to the parent's level; to Everyone only while it is on; replies stay.
select tests.act_as(:'a');
select public.set_note_visibility(:'q', 'public');
reset role;
select is(array[tests.vis(:'q'), tests.vis(:'rq')], array['public', 'private'],
  'widening the note widens none of its replies');
select tests.act_as(:'f');
select public.set_note_visibility(:'rq', 'friends');
select tests.act_as(:'jo');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'rq_jo', 'public')),
  '22023 note_wider_than_parent', 'widening a reply above its parent is refused');
select tests.act_as(:'f');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'rq', 'public')), 'ok',
  'a reply can be widened up to its parent''s level');
select tests.act_as(:'a');
select public.set_note_visibility(:'q', 'friends');
select tests.act_as(:'f');
select is(tests.vis(:'rq'), 'friends', '(Ben''s reply narrowed with it)');
reset role;
select tests.switch(false);
select tests.act_as(:'a');
select tests.note(:'room', :'ch4', 'Anna: friends only', 'friends') as q2 \gset
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'q2', 'public')),
  'PT409 notes_public_off', 'widening to Everyone is refused while it is off');
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L)', :'room', :'ch4', 'public while off', 'public')),
  'PT409 notes_public_off', 'posting at Everyone is refused while it is off');
reset role;
select tests.switch(true);
select tests.act_as(:'f');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'q2', 'private')),
  'PT404 not_found', 'nobody changes the level of a note that is not hers');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'rq', 'members')),
  '22023 invalid_visibility', 'members is not a level she can choose');
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L)', :'room', :'ch4', 'odd', 'everyone')),
  '22023 invalid_visibility', 'post_note: an unknown level is refused');
reset role;

-- A tombstone keeps its level, and is shown to whoever could see the note.
select tests.act_as(:'mira');
select tests.note(:'room', :'ch4', 'Mira: soon gone', 'public') as gone \gset
select public.delete_note(:'gone');
reset role;
select is(tests.vis(:'gone'), 'public', 'a tombstone keeps its level');
select tests.act_as(:'s');
select tests.in_page(public.note_messages(:'room', :'ch4'), :'gone') as gone_json \gset
reset role;
select is(:'gone_json'::jsonb ->> 'kind', 'removed', 'S sees the public tombstone as removed');
select is(:'gone_json'::jsonb -> 'body', 'null'::jsonb, 'with no body');
select tests.act_as(:'mira');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'gone', 'friends')), 'PT404 not_found',
  'a tombstone''s level cannot be changed');
reset role;

-- At commit, no note is narrower than a reply to it (the deferred backstop).
select is(tests.outcome(format(
  $$update public.room_messages set visibility = 'private' where id = %L; set constraints public.room_messages_replies_check immediate$$, :'anna')),
  '23514 note_wider_than_parent', 'constraint trigger: narrowing a note under its replies without them fails at commit');
set constraints all deferred;

-- ------------------------------------------------------------------------- 4. counts never leak

-- Chapter 5 holds only A's private and friends notes.
select tests.sec(:'room', 5) as ch5 \gset
select tests.act_as(:'a');
select tests.note(:'room', :'ch5', 'A, private, ch5', 'private');
select tests.note(:'room', :'ch5', 'A, friends, ch5', 'friends') as ch5_fr \gset
reset role;
create or replace function tests.row_of(p_viewer uuid, p_position integer)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.act_as(p_viewer);
  v := tests.chapter(public.book_notes(tests.id('book')), p_position);
  reset role;
  return v;
end;
$$;
reset role;
select is(tests.row_of(:'s', 5) ->> 'count', '0', 'S: a chapter with only notes she cannot see counts 0');
select is(tests.row_of(:'s', 5) -> 'faces', '[]'::jsonb, 'and shows no face');
select is(tests.row_of(:'s', 5) ->> 'unread', '0', 'and no unread');
select is(tests.row_of(:'f', 5) ->> 'count', '1', 'F: the same chapter counts the friends note only');
select is(tests.row_of(:'a', 5) ->> 'count', '2', 'A: her own two');
select is(tests.row_of(:'a', 5) ->> 'unread', '0', 'her own notes are never unread for her');

-- Unread only on open chapters: F on chapter 4 by hand.
select tests.act_as(:'f');
select public.set_note_chapter(:'room', 4) ->> 'chapter' as f_ch \gset
reset role;
select is(:'f_ch'::text, '4', 'F set chapter 4 by hand');
select is(tests.row_of(:'f', 5) ->> 'open', 'false', 'chapter 5 is veiled for her');
select is(tests.row_of(:'f', 5) ->> 'count', '1', 'a veiled chapter still shows its count');
select is(tests.row_of(:'f', 5) ->> 'unread', '0', 'but no unread');
select is(tests.row_of(:'f', 5) -> 'faces', '[]'::jsonb, 'and no faces');
select tests.act_as(:'f');
select public.set_note_chapter(:'room', 5);
reset role;
select is(tests.row_of(:'f', 5) ->> 'unread', '1', 'opened: its new note is unread');
select is(tests.ids(tests.row_of(:'f', 5) -> 'faces'), array[:'a']::uuid[], 'and A''s face shows');
select tests.act_as(:'f');
select public.mark_notes_read(:'room', :'ch5', null) ? 'lastReadAt' as marked \gset
reset role;
select is(:'marked'::boolean, true, 'mark_notes_read answers her cursor');
select is(tests.row_of(:'f', 5) ->> 'unread', '0', 'read: nothing unread');
select tests.act_as(:'f');
select public.mark_notes_read(:'room', :'ch5', '2000-01-01') ->> 'lastReadAt' as kept \gset
reset role;
select ok(:'kept'::timestamptz > '2001-01-01', 'the cursor only moves forward');
select tests.act_as(:'f');
select is(tests.outcome(format('select public.mark_notes_read(%L, %L, null)', :'room', tests.sec(:'room', 99))), 'PT404 not_found',
  'mark_notes_read: a chapter not in the room is not found');
reset role;

-- Reactions: S's public note in chapter 6, a heart from F and from B1 (whom A blocked).
select tests.sec(:'room', 6) as ch6 \gset
select tests.act_as(:'s');
select tests.note(:'room', :'ch6', 'S: react to me', 'public') as sn \gset
select tests.act_as(:'f');
select public.react_to_note(:'sn', '❤️');
select tests.act_as(:'b1');
select public.react_to_note(:'sn', '❤️') -> 'myReaction' as b1_mine \gset
select tests.act_as(:'a');
select tests.in_page(public.note_messages(:'room', :'ch6'), :'sn') -> 'reactions' as a_reacts \gset
select tests.act_as(:'f');
select tests.in_page(public.note_messages(:'room', :'ch6'), :'sn') as f_sn \gset
reset role;
select is(:'b1_mine'::jsonb, '"❤️"'::jsonb, 'react_to_note answers her reaction');
select is(:'a_reacts'::jsonb, '[{"emoji": "❤️", "count": 1}]'::jsonb, 'A does not count the heart of B1, whom she blocked');
select is(:'f_sn'::jsonb -> 'reactions', '[{"emoji": "❤️", "count": 2}]'::jsonb, 'F counts both hearts');
select is(:'f_sn'::jsonb -> 'myReaction', '"❤️"'::jsonb, 'and sees her own');
select tests.act_as(:'f');
select is(public.react_to_note(:'sn', '❤️') -> 'myReaction', 'null'::jsonb, 'the same emoji again removes it');
select is(public.react_to_note(:'sn', '🔥') -> 'reactions', '[{"emoji": "❤️", "count": 1}, {"emoji": "🔥", "count": 1}]'::jsonb,
  'another emoji sets it');
select is(public.react_to_note(:'sn', '📚') -> 'myReaction', '"📚"'::jsonb, 'and changes it: one per member');
select is(public.react_to_note(:'sn', null) -> 'myReaction', 'null'::jsonb, 'null removes it');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'sn', '👍')), '22023 invalid_emoji', 'one of the six only');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'n_priv', '❤️')), 'PT404 not_found',
  'no reaction to a note she cannot see (the same answer as no note)');
select tests.act_as(:'b2');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'n_pub', '❤️')), 'PT404 not_found',
  'B2 (who blocked A) cannot react to A''s public note');
reset role;

-- ------------------------------------------------------------------------- the thread's answer

select tests.act_as(:'a');
select tests.in_page(public.note_messages(:'room', tests.sec(:'room', 1)), :'n_pub') as a_pub \gset
select tests.act_as(:'f');
select tests.in_page(public.note_messages(:'room', tests.sec(:'room', 1)), :'n_pub') as f_pub \gset
reset role;
select is(array(select jsonb_object_keys(:'a_pub'::jsonb) order by 1),
  array['author', 'body', 'clientId', 'createdAt', 'effectiveVisibility', 'id', 'kind', 'mine', 'myReaction', 'quote',
        'reactions', 'sectionId', 'spoiler', 'visibility'],
  'a note''s keys');
select is((:'a_pub'::jsonb ->> 'mine')::boolean, true, 'mine for its author');
select ok(:'a_pub'::jsonb ->> 'clientId' is not null, 'its author gets her client id');
select is((:'f_pub'::jsonb ->> 'mine')::boolean, false, 'not mine for F');
select is(:'f_pub'::jsonb -> 'clientId', 'null'::jsonb, 'nobody else gets the client id');
select is(:'f_pub'::jsonb -> 'author' ->> 'name', 'Anna A', 'the author''s card');
select is(:'f_pub'::jsonb ->> 'kind', 'note', 'kind note');
select is(:'f_pub'::jsonb -> 'quote', 'null'::jsonb, 'no quote on a note that answers nothing');

-- Pages, by time.
select tests.sec(:'room', 7) as ch7 \gset
select tests.act_as(:'a');
select tests.note(:'room', :'ch7', 'page ' || k, 'friends') from generate_series(1, 5) k;
select public.note_messages(:'room', :'ch7', null, 2) as pg1 \gset
select public.note_messages(:'room', :'ch7', (:'pg1'::jsonb -> 1 ->> 'createdAt')::timestamptz, 2) as pg2 \gset
reset role;
select is(array(select x ->> 'body' from jsonb_array_elements(:'pg1'::jsonb) x), array['page 5', 'page 4'], 'newest first, p_limit');
select is(array(select x ->> 'body' from jsonb_array_elements(:'pg2'::jsonb) x), array['page 3', 'page 2'], 'p_before pages on');
select tests.act_as(:'a');
select is(jsonb_array_length(public.note_messages(:'room', :'ch7', null, 1000)), 5, 'p_limit is at most 100 (and here all 5)');
select is(tests.outcome(format('select public.note_messages(%L, %L)', :'room', gen_random_uuid())), 'PT404 not_found',
  'note_messages: a chapter of no room is not found');
reset role;

-- Idempotent on the client id; a client id reused elsewhere is refused.
select gen_random_uuid() as cid \gset
select tests.act_as(:'a');
select public.post_note(:'room', :'ch7', :'cid', 'once', 'friends') ->> 'id' as once1 \gset
select public.post_note(:'room', :'ch7', :'cid', 'once', 'friends') ->> 'id' as once2 \gset
select is(:'once1'::text, :'once2', 'a resend with the same client id is the same note');
select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', :'ch6', :'cid', 'elsewhere', 'friends')),
  'PT409 client_id_reused', 'the same client id in another chapter is refused');
select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', :'ch7', gen_random_uuid(), E' \n\t', 'friends')),
  '22023 body_empty', 'a body with nothing visible is refused');
select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', :'ch7', gen_random_uuid(), repeat('x', 2001), 'friends')),
  '22023 body_too_long', 'more than 2000 characters are refused');
select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', :'ch7', null, 'x', 'friends')),
  '22023 client_id_required', 'a client id is required');
select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', tests.sec(:'room', 99), gen_random_uuid(), 'x', 'friends')),
  'PT404 not_found', 'a chapter of another room (or none) is not found');
reset role;
-- Writing needs the Book (decision 9): O1 has no entry of the Work, and reads anyway.
select tests.act_as(:'o1');
select is(tests.outcome(format('select tests.note(%L, %L, %L, %L)', :'room', :'ch7', 'no book', 'friends')),
  'PT403 notes_need_book', 'O1 cannot write without the Book');
select is((public.book_notes(:'book') ->> 'canWrite')::boolean, false, 'book_notes says so: canWrite false');
select tests.act_as(:'f');
select is((public.book_notes(:'book') ->> 'canWrite')::boolean, true, 'and canWrite true for F, who has it');
reset role;

-- A blocked member's replies: S's public note in chapter 8, Mira answers it at Everyone. Once A blocks Mira,
-- her reply leaves A's count, faces and Book page line, and stays for S.
select tests.sec(:'room', 8) as ch8 \gset
select tests.act_as(:'s');
select tests.note(:'room', :'ch8', 'S: chapter 8', 'public') as s8 \gset
select tests.act_as(:'mira');
select tests.note(:'room', :'ch8', 'Mira answers S', 'public', :'s8') as mira8 \gset
reset role;
create or replace function tests.summary_of(p_viewer uuid)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.act_as(p_viewer);
  v := public.notes_summary(tests.id('book'));
  reset role;
  return v;
end;
$$;
select (tests.summary_of(:'a') -> 'public' ->> 'count')::int as a_pub_before \gset
select is(tests.row_of(:'a', 8) ->> 'count', '2', 'before the block, A counts S''s note and Mira''s reply');
select is(tests.sorted(tests.ids(tests.row_of(:'a', 8) -> 'faces')), tests.sorted(array[:'s', :'mira']::uuid[]), 'and shows both faces');
select tests.block(:'a', :'mira');
select is(tests.row_of(:'a', 8) ->> 'count', '1', 'A blocked Mira: her reply leaves A''s chapter count');
select is(tests.ids(tests.row_of(:'a', 8) -> 'faces'), array[:'s']::uuid[], 'and her face');
select is((tests.summary_of(:'a') -> 'public' ->> 'count')::int, :'a_pub_before'::int - 2,
  'and A''s Public line on the Book page loses Mira''s two live public notes (this reply and her note in chapter 2)');
select is(tests.page_ids(:'a', :'room', :'ch8'), array[:'s8']::uuid[], 'and A''s thread');
select is(tests.row_of(:'s', 8) ->> 'count', '2', 'S still counts both');
select tests.unblock(:'a', :'mira');

-- ------------------------------------------------------------------------- visible_notes = can_see_note

-- Every fixture note of this file, every member of it, Everyone on and off: the set and the function agree.
create or replace function tests.disagreements()
returns integer language sql as $$
  select count(*)::integer
    from auth.users u
   cross join public.room_messages m
   where u.email like '%@notes.test' and m.room_id = tests.id('room')
     and private.can_see_note(u.id, m.id) <> exists (select 1 from private.visible_notes(u.id, m.room_id) v where v.id = m.id)
$$;
select ok((select count(*) from public.room_messages where room_id = :'room') > 20, '(the fixture has notes at every level)');
select is(tests.disagreements(), 0, 'Everyone on: visible_notes and can_see_note agree on every fixture note for every fixture member');
select tests.switch(false);
select is(tests.disagreements(), 0, 'Everyone off: they agree too');
select tests.switch(true);
select tests.block(:'f', :'mira');
select is(tests.disagreements(), 0, 'with one more block: they agree too');
select is((select count(*)::int from private.visible_notes(null, :'room')), 0, 'visible_notes answers nothing to nobody');

-- ------------------------------------------------------------------------- 9. grants

select is(
  (select count(*)::int from unnest(array[
     'public.notes_config()', 'public.book_notes(uuid)', 'public.notes_summary(uuid)',
     'public.set_book_chapters(uuid, integer)', 'public.add_book_chapters(uuid, integer)',
     'public.owner_set_chapter_count(uuid, integer)', 'public.set_note_chapter(uuid, integer, boolean)',
     'public.note_messages(uuid, uuid, timestamptz, integer, uuid)',
     'public.post_note(uuid, uuid, uuid, text, text, uuid, boolean)', 'public.set_note_visibility(uuid, text)',
     'public.react_to_note(uuid, text)', 'public.delete_note(uuid)', 'public.report_note(uuid, text, text)',
     'public.mark_notes_read(uuid, uuid, timestamptz)', 'public.owner_set_notes_public(boolean)',
     'public.owner_remove_note(uuid, text)']) f
   where has_function_privilege('anon', f, 'execute')
      or not has_function_privilege('authenticated', f, 'execute')
      or not (select prosecdef from pg_proc where oid = f::regprocedure)
      or (select proconfig from pg_proc where oid = f::regprocedure) is distinct from array['search_path=pg_catalog, public, private']),
  0, 'the 16 functions: authenticated only, security definer, search path pinned');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('notes_config', 'book_notes', 'notes_summary', 'set_book_chapters',
            'add_book_chapters', 'owner_set_chapter_count', 'set_note_chapter', 'note_messages', 'post_note',
            'set_note_visibility', 'react_to_note', 'delete_note', 'report_note', 'mark_notes_read',
            'owner_set_notes_public', 'owner_remove_note')),
  16, 'and no other overload of them');
select is(
  (select count(*)::int from unnest(array['private.can_see_note(uuid, uuid)', 'private.notes_public_enabled()',
       'private.note_author_seen(uuid, uuid)', 'private.note_photo_seen(uuid, uuid)', 'private.room_messages_check()',
       'private.room_messages_replies_check()', 'private.room_sections_order()']) f
    where not (select prosecdef from pg_proc where oid = f::regprocedure)
       or (select proconfig from pg_proc where oid = f::regprocedure) is distinct from array['search_path=""']),
  0, 'can_see_note, notes_public_enabled, note_author_seen, note_photo_seen and the three triggers: security definer, search_path empty');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('note_level', 'book_work_key', 'work_books', 'notes_room_for', 'has_work', 'mutual_friends',
                        'notes_public_enabled', 'can_see_note', 'visible_notes', 'note_chapter', 'note_quote',
                        'note_json', 'notes_page', 'notes_lock', 'note_rate', 'note_author_seen', 'note_photo_seen',
                        'purge_note_moderation_log', 'room_messages_check', 'room_messages_replies_check',
                        'room_sections_order')
      and (p.proconfig is null
           or has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'the 21 helpers: search path pinned, nobody else may execute them');
select is(
  (select count(*)::int from unnest(array['public.rooms', 'public.room_sections', 'public.room_messages',
       'public.room_reactions', 'public.room_cursors', 'public.note_positions']) t
    cross join unnest(array['select', 'insert', 'update', 'delete']) priv
    cross join unnest(array['anon', 'authenticated']) r
   where has_table_privilege(r, t, priv)),
  0, 'anon and authenticated can read and write none of the six tables');
select is(
  (select count(*)::int from pg_class c
    where c.oid in ('public.rooms'::regclass, 'public.room_sections'::regclass, 'public.room_messages'::regclass,
                    'public.room_reactions'::regclass, 'public.room_cursors'::regclass, 'public.note_positions'::regclass,
                    'private.notes_settings'::regclass, 'private.note_moderation_log'::regclass, 'private.note_calls'::regclass)
      and c.relrowsecurity),
  9, 'RLS is on for all nine tables');
select is(
  (select count(*)::int from pg_policies where (schemaname, tablename) in
     (('public', 'rooms'), ('public', 'room_sections'), ('public', 'room_messages'), ('public', 'room_reactions'),
      ('public', 'room_cursors'), ('public', 'note_positions'), ('private', 'notes_settings'),
      ('private', 'note_moderation_log'), ('private', 'note_calls'))),
  0, 'with no policy');
select tests.act_as(:'a');
select is(tests.outcome('select count(*) from public.room_messages'), '42501 permission denied for table room_messages',
  'a member cannot read room_messages directly');
select is(tests.outcome(format($$insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility)
                                  values (%L, %L, %L, gen_random_uuid(), 'x', 'public')$$, :'room', :'ch7', :'a')),
  '42501 permission denied for table room_messages', 'nor write it');
select is(tests.outcome('select private.can_see_note(null, null)'), '42501 permission denied for schema private',
  'nor call the private helpers');
reset role;

-- Everything deferred holds at commit.
select is(tests.outcome('set constraints all immediate'), 'ok', 'every deferred check of this file passes');

select * from finish();
rollback;
