-- Notes on a Book, N1: chapters, her chapter, limits, moderation, the two shipped functions, account
-- deletion (migration 20261116010000_book_notes.sql; brief docs/plans/book-notes/briefs/N1-database.md,
-- pgTAP items 5 to 8 and 10):
--   supabase test db
--
-- One chapter list per Work: set once (a second edition of the Work gets chapters_already_set and the
-- same room), editions tied by Open Library or ISBN share it, a title match does not, no Notes on a
-- Manual book; chapters are added at the end with their ids kept and removed at the end only while no
-- note (a tombstone included) is in them. Her chapter: the worked examples of the plan (43 chapters,
-- page 119 of 384 is chapter 13, 50 % is 21, a finished read, no read, two editions, her hand both
-- ways, Automatic). The limits. Reports, the owner's switch and removal, the record's purge. block()
-- and can_see_photo through a note. Her account deleted. Who sees a note: book_notes_test.sql.
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(127);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-NOTES-2', 'book notes rules test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-NOTES-2', 'name', p_name)), now(), now(), now());
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

create or replace function tests.outcome(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

create or replace function tests.snap(p_title text, p_pages integer default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9840000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'page_count', p_pages))
$$;

create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
  on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null
$$;
create or replace function tests.switch(p_on boolean)
returns void language sql security definer as $$
  update private.notes_settings set public_enabled = p_on
$$;
create or replace function tests.tie(p_book uuid, p_work uuid, p_by text)
returns uuid language plpgsql security definer as $$
declare v_work uuid := p_work;
begin
  if v_work is null then
    insert into public.works (wikidata_id, title) values ('Q9' || (random() * 1e9)::bigint, 'A work ' || p_book)
    returning id into v_work;
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
create or replace function tests.section_ids(p_room uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.room_sections where room_id = p_room
$$;
create or replace function tests.end_of(p_room uuid)
returns jsonb language sql security definer as $$
  select jsonb_build_object('id', id, 'position', position) from public.room_sections where room_id = p_room and kind = 'end'
$$;
create or replace function tests.msg(p_id uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.room_messages m where m.id = p_id
$$;
create or replace function tests.note(p_room uuid, p_position integer, p_body text, p_visibility text,
                                      p_reply_to uuid default null)
returns uuid language sql as $$
  select (public.post_note(p_room, tests.sec(p_room, p_position), gen_random_uuid(), p_body, p_visibility, p_reply_to) ->> 'id')::uuid
$$;
create or replace function tests.fill_notes(p_room uuid, p_author uuid, p_n integer, p_age interval, p_visibility text)
returns void language sql security definer as $$
  insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility, created_at)
  select p_room, tests.sec(p_room, 1), p_author, gen_random_uuid(), 'filler ' || k, p_visibility, clock_timestamp() - p_age
    from generate_series(1, p_n) k
$$;
create or replace function tests.fill_calls(p_member uuid, p_kind text, p_n integer)
returns void language sql security definer as $$
  insert into private.note_calls (member_id, kind) select p_member, p_kind from generate_series(1, p_n)
$$;
create or replace function tests.clear_calls(p_member uuid)
returns void language sql security definer as $$
  delete from private.note_calls where member_id = p_member
$$;
create or replace function tests.fill_feedback(p_member uuid, p_n integer)
returns void language sql security definer as $$
  insert into public.feedback (member_id, kind, body) select p_member, 'other', 'An earlier message ' || k
    from generate_series(1, p_n) k
$$;
create or replace function tests.reports(p_member uuid, p_note uuid)
returns setof public.feedback language sql security definer as $$
  select * from public.feedback where member_id = p_member and kind = 'report' and context ->> 'note' = p_note::text
$$;
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;
create or replace function tests.log_of(p_note uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(l) from private.note_moderation_log l where l.message_id = p_note
$$;
create or replace function tests.reactions_on(p_note uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.room_reactions where message_id = p_note
$$;
create or replace function tests.of_member(p_member uuid)
returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'notes', (select count(*) from public.room_messages where author_id = p_member),
    'reactions', (select count(*) from public.room_reactions where member_id = p_member),
    'positions', (select count(*) from public.note_positions where member_id = p_member),
    'cursors', (select count(*) from public.room_cursors where member_id = p_member),
    'log', (select count(*) from private.note_moderation_log where author_id = p_member),
    'calls', (select count(*) from private.note_calls where member_id = p_member))
$$;
create or replace function tests.set_by(p_room uuid)
returns uuid language sql security definer as $$
  select chapters_set_by from public.rooms where id = p_room
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select (now() at time zone 'utc')::date as today \gset

-- Everyone is off at release; this file runs with it on, and turns it off where it says so.
select is(private.notes_public_enabled(), false, 'Everyone is off after the migration (safe by default)');
select tests.switch(true);

-- ------------------------------------------------------------------------- 5. chapters

select tests.member('x@rules.test', 'Xenia X') as x \gset
select tests.member('q@rules.test', 'Quinn Q') as q \gset
select tests.member('n@rules.test', 'Nina N') as n \gset

-- Three editions: e1 and e2 tied to one Work by Open Library and by ISBN, e3 tied to it by title only.
select tests.act_as(:'x');
select (public.add_to_library(tests.snap('Rule Book', 384))).id as x_e1 \gset
select tests.act_as(:'q');
select (public.add_to_library(tests.snap('Rule Book, other edition', 400))).id as q_e2 \gset
select (public.add_to_library(tests.snap('Rule Book, title match', 300))).id as q_e3 \gset
reset role;
select tests.book_of(:'x_e1') as e1 \gset
select tests.book_of(:'q_e2') as e2 \gset
select tests.book_of(:'q_e3') as e3 \gset
select tests.tie(:'e1', null, 'openlibrary') as w \gset
select tests.tie(:'e2', :'w', 'isbn');
select tests.tie(:'e3', :'w', 'title');

select is(private.book_work_key(:'e1'), 'w:' || :'w', 'book_work_key: an Open Library tie is the Work');
select is(private.book_work_key(:'e2'), 'w:' || :'w', 'an ISBN tie is the Work too');
select is(private.book_work_key(:'e3'), 'b:' || :'e3', 'a title match is not trusted: the Book itself');

select tests.act_as(:'n');
select is(tests.outcome(format('select public.set_book_chapters(%L, 5)', :'e1')), 'PT403 notes_need_book',
  'without an entry of the Work she cannot set chapters');
select is(public.book_notes(:'e1'), jsonb_build_object('workKey', 'w:' || :'w', 'canWrite', false, 'room', null),
  'book_notes before anyone set them: no room');
select tests.act_as(:'x');
select is(tests.outcome(format('select public.set_book_chapters(%L, 0)', :'e1')), '22023 invalid_count', '0 chapters: invalid_count');
select is(tests.outcome(format('select public.set_book_chapters(%L, 301)', :'e1')), '22023 invalid_count', '301 chapters: invalid_count');
select is(tests.outcome(format('select public.book_notes(%L)', gen_random_uuid())), 'PT404 not_found', 'no such Book: not_found');
select public.set_book_chapters(:'e1', 43) as made \gset
reset role;
select (:'made'::jsonb -> 'room' ->> 'id') as room \gset
select is((:'made'::jsonb -> 'room' ->> 'chapterCount')::int, 43, 'set_book_chapters makes 43 chapters');
select is(jsonb_array_length(:'made'::jsonb -> 'room' -> 'chapters'), 44, 'and The whole book');
select is(:'made'::jsonb -> 'room' -> 'chapters' -> 43 ->> 'kind', 'end', 'last');
select is(tests.set_by(:'room'), :'x'::uuid, 'who set them is kept (to limit abuse)');
select is(array(select jsonb_object_keys(:'made'::jsonb -> 'room' -> 'chapters' -> 0) order by 1),
  array['count', 'faces', 'id', 'kind', 'open', 'position', 'unread'], 'a chapter row''s keys');

select tests.act_as(:'q');
select is(tests.outcome(format('select public.set_book_chapters(%L, 12)', :'e2')), 'PT409 chapters_already_set',
  'another edition of the Work: chapters_already_set');
select is(public.book_notes(:'e2') -> 'room' ->> 'id', :'room', 'and its Notes page is the same room');
select is((public.book_notes(:'e2') -> 'room' ->> 'chapterCount')::int, 43, 'with the 43 chapters');
select is(public.book_notes(:'e3') -> 'room', 'null'::jsonb, 'the title-matched edition has no room of its own yet');
select is(public.book_notes(:'e3') ->> 'workKey', 'b:' || :'e3', 'its key is the Book');
select ok((public.set_book_chapters(:'e3', 7) -> 'room' ->> 'id') <> :'room', 'and its chapters are its own');
reset role;

-- Manual books: no Notes.
select tests.act_as(:'x');
select (public.add_manual_book('My own notes book', array['Me'])).book_id as manual \gset
select is(tests.outcome(format('select public.book_notes(%L)', :'manual')), '22023 notes_unavailable', 'her Manual book: notes_unavailable');
select is(tests.outcome(format('select public.set_book_chapters(%L, 5)', :'manual')), '22023 notes_unavailable',
  'no chapters on a Manual book');
select tests.act_as(:'q');
select is(tests.outcome(format('select public.book_notes(%L)', :'manual')), 'PT404 not_found',
  'someone else''s Manual book: not_found');
select is(public.notes_summary(:'manual') -> 'friends' ->> 'count', '0', 'notes_summary of a Manual book: zeros');
reset role;

-- Adding keeps the ids; the end moves up.
select tests.section_ids(:'room') as ids_before \gset
select tests.act_as(:'n');
select is(tests.outcome(format('select public.add_book_chapters(%L, 1)', :'room')), 'PT403 notes_need_book', 'adding needs the Book');
select tests.act_as(:'q');
select is((public.add_book_chapters(:'room', 2) -> 'room' ->> 'chapterCount')::int, 45, 'Q (another edition) adds 2: 45 chapters');
reset role;
select is((tests.section_ids(:'room'))[1:43], (:'ids_before'::uuid[])[1:43], 'the 43 chapters keep their ids');
select is(tests.end_of(:'room'), jsonb_build_object('id', (:'ids_before'::uuid[])[44], 'position', 46),
  'The whole book keeps its id and moves to 46');
select tests.act_as(:'q');
select is(tests.outcome(format('select public.add_book_chapters(%L, 256)', :'room')), '22023 invalid_count', 'never past 300');
select is(tests.outcome(format('select public.add_book_chapters(%L, 0)', :'room')), '22023 invalid_count', 'adding 0: invalid_count');
select is(tests.outcome(format('select public.add_book_chapters(%L, 1)', gen_random_uuid())), 'PT404 not_found', 'no such room');
select is(tests.outcome(format('select public.add_book_chapters(%L, 2147483647)', :'room')), '22023 invalid_count',
  'a huge count is invalid_count, not an integer overflow');

-- No member function's answer depends on notes she cannot see: there is no member removal of chapters, and
-- adding answers the same with a hidden note in the last chapter.
reset role;
select is(to_regprocedure('public.remove_book_chapters(uuid, integer)'), null::regprocedure, 'there is no remove_book_chapters');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosrc like '%chapter_has_notes%'),
  array['owner_set_chapter_count'], 'the only function whose refusal depends on the notes in a chapter is the owner''s');
select tests.act_as(:'x');
select tests.note(:'room', 45, 'X, hidden in the last chapter', 'private') as hidden45 \gset
select tests.act_as(:'q');
select is((select c ->> 'count' from jsonb_array_elements(public.book_notes(:'e2') -> 'room' -> 'chapters') c
            where (c ->> 'position')::int = 45), '0', 'Q sees nothing in chapter 45');
select is((public.add_book_chapters(:'room', 1) -> 'room' ->> 'chapterCount')::int, 46,
  'and adding a chapter after it answers as it would without the hidden note');
reset role;

-- The owner mends the count: never below the highest chapter holding a note (a tombstone counts), logged.
select tests.member('boss@rules.test', 'Boss') as boss \gset
select tests.name_owner(:'boss');
select tests.act_as(:'q');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 44)', :'room')), '42501 not_owner',
  'owner_set_chapter_count: not_owner for a member');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 44)', gen_random_uuid())), '42501 not_owner',
  'the same answer for a room that does not exist');
select tests.act_as(:'x');
select public.delete_note(:'hidden45');
select tests.act_as(:'boss');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 44)', :'room')), 'PT409 chapter_has_notes',
  'the owner cannot go below a chapter holding a note, deleted or not, anyone''s');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 0)', :'room')), '22023 invalid_count', 'at least 1');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 2147483647)', :'room')), '22023 invalid_count',
  'at most 300, no overflow');
select is(tests.outcome(format('select public.owner_set_chapter_count(%L, 5)', gen_random_uuid())), 'PT404 not_found',
  'no such room');
select is(public.owner_set_chapter_count(:'room', 45), '{"chapterCount": 45, "was": 46}'::jsonb, 'the owner removes the empty 46th');
reset role;
select is(tests.end_of(:'room') ->> 'position', '46', 'The whole book moves down');
select is((tests.section_ids(:'room'))[1:43], (:'ids_before'::uuid[])[1:43], 'the chapters keep their ids');
select is((select reason from private.note_moderation_log where action = 'chapter_count' and room_id = :'room'::uuid),
  'chapters 46 -> 45', 'the change is in the owner''s record');
select is((select removed_by from private.note_moderation_log where action = 'chapter_count' and room_id = :'room'::uuid),
  :'boss'::uuid, 'with who made it');
select tests.act_as(:'boss');
select is(public.owner_set_chapter_count(:'room', 50) ->> 'chapterCount', '50', 'and can add chapters too');
reset role;
select is(tests.end_of(:'room') ->> 'position', '51', '(The whole book after them)');

-- The deferred backstop on the order: a part after the end fails at commit.
select is(tests.outcome(format(
  $$insert into public.room_sections (room_id, position, kind) values (%L, 52, 'part'); set constraints public.room_sections_order immediate$$, :'room')),
  '23514 room_sections_invalid: positions 1..n, one end, last', 'constraint trigger: a part after The whole book fails');
set constraints all deferred;

-- Chapter changes: 20 a day.
select tests.fill_calls(:'q', 'chapters', 20);
select tests.act_as(:'q');
select is(tests.outcome(format('select public.add_book_chapters(%L, 1)', :'room')), 'PT429 rate_limited', 'the 21st chapter change of a day: rate_limited');
reset role;
select tests.clear_calls(:'q');

-- ------------------------------------------------------------------------- 6. her chapter

create or replace function tests.chapter_of(p_member uuid, p_room uuid)
returns jsonb language sql security definer as $$ select private.note_chapter(p_member, p_room) $$;

-- A room of 43 chapters on its own Work.
select tests.member('r1@rules.test', 'Rita') as r1 \gset
select tests.act_as(:'r1');
select (public.add_to_library(tests.snap('Chapter Book', 384))).id as r1_e \gset
reset role;
select tests.book_of(:'r1_e') as cb1 \gset
select tests.tie(:'cb1', null, 'openlibrary') as cw \gset
select tests.act_as(:'r1');
select public.set_book_chapters(:'cb1', 43) -> 'room' ->> 'id' as croom \gset
reset role;
select is(tests.chapter_of(:'r1', :'croom'),
  '{"chapter": 0, "finished": false, "hand": false, "auto": {"chapter": 0, "finished": false}}'::jsonb,
  'no session: chapter 0, nothing open');
select tests.act_as(:'r1');
select public.start_reading(:'r1_e', :'today'::date);
reset role;
select is(tests.chapter_of(:'r1', :'croom') ->> 'chapter', '1', 'a session open, no progress: chapter 1');
select tests.act_as(:'r1');
select public.update_progress(:'r1_e', 119);
reset role;
select is(tests.chapter_of(:'r1', :'croom'),
  '{"chapter": 13, "finished": false, "hand": false, "auto": {"chapter": 13, "finished": false}}'::jsonb,
  '43 chapters, page 119 of 384 (31 %): chapter 13');
select tests.act_as(:'r1');
select public.update_progress(:'r1_e', null, 50);
reset role;
select is(tests.chapter_of(:'r1', :'croom') ->> 'chapter', '21', 'percent 50: chapter 21');
select tests.act_as(:'r1');
select public.update_progress(:'r1_e', 100, null, true, 200);
reset role;
select is(tests.chapter_of(:'r1', :'croom') ->> 'chapter', '21', 'her own page count first: page 100 of her 200 is chapter 21');

-- The page the Notes page shows: chapters 1..21 open, 22 on veiled.
select tests.act_as(:'r1');
select public.book_notes(:'cb1') as r1_page \gset
reset role;
select is(array(select (c ->> 'position')::int from jsonb_array_elements(:'r1_page'::jsonb -> 'room' -> 'chapters') c
                 where (c ->> 'open')::boolean order by 1),
  array(select generate_series(1, 21)), 'open for her: chapters 1 to 21 (The whole book not before she finished)');
select is(:'r1_page'::jsonb -> 'room' -> 'me' ->> 'chapter', '21', 'book_notes carries her chapter');

-- Finished last year: the whole Book.
select tests.member('r2@rules.test', 'Rolf') as r2 \gset
select tests.act_as(:'r2');
select public.add_to_library(tests.snap('Chapter Book', 384), 'finished',
                             (:'today'::date - interval '400 days')::date, (:'today'::date - interval '380 days')::date);
reset role;
select is(tests.chapter_of(:'r2', :'croom'),
  '{"chapter": 43, "finished": true, "hand": false, "auto": {"chapter": 43, "finished": true}}'::jsonb,
  'finished last year: finished, every chapter');
select tests.act_as(:'r2');
select is((select bool_and((c ->> 'open')::boolean) from jsonb_array_elements(public.book_notes(:'cb1') -> 'room' -> 'chapters') c),
  true, 'every chapter and The whole book open');
reset role;

-- Two editions: the furthest wins.
select tests.member('r3@rules.test', 'Rosa') as r3 \gset
select tests.act_as(:'r3');
select (public.add_to_library(tests.snap('Chapter Book', 384))).id as r3_a \gset
select (public.add_to_library(tests.snap('Chapter Book, large print', 400))).id as r3_b \gset
reset role;
select tests.tie(tests.book_of(:'r3_b'), :'cw', 'openlibrary');
select tests.act_as(:'r3');
select public.start_reading(:'r3_a', :'today'::date);
select public.update_progress(:'r3_a', 100);
select public.start_reading(:'r3_b', :'today'::date);
select public.update_progress(:'r3_b', 300);
reset role;
select is(tests.chapter_of(:'r3', :'croom') ->> 'chapter', '32',
  'two editions: page 100 of 384 and page 300 of 400; the furthest (0.75 x 43) wins: chapter 32');

-- Her hand wins both ways; Automatic clears it.
select tests.act_as(:'r3');
select is(public.set_note_chapter(:'croom', 5),
  '{"chapter": 5, "finished": false, "hand": true, "auto": {"chapter": 32, "finished": false}}'::jsonb,
  'her hand below the automatic chapter wins');
select is(public.set_note_chapter(:'croom', 40) ->> 'chapter', '40', 'and above it');
select is(public.set_note_chapter(:'croom', null, true),
  '{"chapter": 43, "finished": true, "hand": true, "auto": {"chapter": 32, "finished": false}}'::jsonb,
  'I''ve finished it, by hand');
select is(public.set_note_chapter(:'croom', null),
  '{"chapter": 32, "finished": false, "hand": false, "auto": {"chapter": 32, "finished": false}}'::jsonb,
  'Automatic clears the hand');
select is(tests.outcome(format('select public.set_note_chapter(%L, 44)', :'croom')), '22023 invalid_chapter', 'chapter 44 of 43: invalid_chapter');
select is(tests.outcome(format('select public.set_note_chapter(%L, 0)', :'croom')), '22023 invalid_chapter', 'chapter 0: invalid_chapter');
select is(tests.outcome(format('select public.set_note_chapter(%L, 3)', gen_random_uuid())), 'PT404 not_found', 'no such room');
reset role;
select is((select count(*)::int from public.note_positions where member_id = :'r3'), 0, 'Automatic: no row');

-- ------------------------------------------------------------------------- limits

select tests.member('l1@rules.test', 'Lea') as l1 \gset
select tests.act_as(:'l1');
select public.add_to_library(tests.snap('Chapter Book', 384));
reset role;
select tests.fill_notes(:'croom', :'l1', 30, interval '0 seconds', 'friends');
select tests.act_as(:'l1');
select is(tests.outcome(format('select tests.note(%L, 2, %L, %L)', :'croom', 'one more', 'friends')), 'PT429 rate_limited',
  '30 notes a minute');
reset role;
select tests.member('l2@rules.test', 'Lou') as l2 \gset
select tests.act_as(:'l2');
select public.add_to_library(tests.snap('Chapter Book', 384));
reset role;
select tests.fill_notes(:'croom', :'l2', 300, interval '2 hours', 'friends');
select tests.act_as(:'l2');
select is(tests.outcome(format('select tests.note(%L, 2, %L, %L)', :'croom', 'one more', 'private')), 'PT429 rate_limited',
  '300 notes a day');
reset role;
select tests.member('l3@rules.test', 'Lin') as l3 \gset
select tests.act_as(:'l3');
select public.add_to_library(tests.snap('Chapter Book', 384));
reset role;
-- Every move to Everyone is one use of 30 in 24 hours: widening old notes uses it, narrowing frees nothing.
create or replace function tests.old_note(p_room uuid, p_author uuid, p_body text)
returns uuid language sql security definer as $$
  insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility, created_at)
  values (p_room, tests.sec(p_room, 1), p_author, gen_random_uuid(), p_body, 'friends', now() - interval '3 days')
  returning id
$$;
create or replace function tests.calls_of(p_member uuid, p_kind text)
returns integer language sql security definer as $$
  select count(*)::integer from private.note_calls where member_id = p_member and kind = p_kind
$$;
select array_agg(tests.old_note(:'croom', :'l3', 'old note ' || k)) as l3_old from generate_series(1, 6) k \gset
select tests.act_as(:'l3');
select public.set_note_visibility(x, 'public') from unnest(:'l3_old'::uuid[]) with ordinality u(x, o) where o <= 5;
reset role;
select is(tests.calls_of(:'l3', 'public'), 5, 'widening five notes written days ago uses five of the 30');
select tests.act_as(:'l3');
select public.set_note_visibility((:'l3_old'::uuid[])[1], 'friends');
select public.set_note_visibility((:'l3_old'::uuid[])[1], 'public');
reset role;
select is(tests.calls_of(:'l3', 'public'), 6, 'narrowing frees none: widening it again uses another');
select tests.fill_calls(:'l3', 'public', 24);
select tests.act_as(:'l3');
select is(tests.outcome(format('select tests.note(%L, 2, %L, %L)', :'croom', 'one more', 'public')), 'PT429 rate_limited',
  '30 moves to Everyone a day: the 31st post is refused');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', (:'l3_old'::uuid[])[6], 'public')), 'PT429 rate_limited',
  'and so is the 31st widening');
select is(tests.outcome(format('select tests.note(%L, 2, %L, %L)', :'croom', 'friends one', 'friends')), 'ok',
  'a friends note is still fine');
select tests.note(:'croom', 2, 'friends to react', 'friends') as l3_fr \gset
reset role;
select tests.fill_calls(:'l3', 'react', 60);
select tests.act_as(:'l3');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'l3_fr', '❤️')), 'PT429 rate_limited', '60 reactions a minute');
reset role;

-- ------------------------------------------------------------------------- 7. moderation

select tests.member('rep@rules.test', 'Reporter') as rep \gset
select tests.member('rep2@rules.test', 'Reporter 2') as rep2 \gset
select tests.member('own@rules.test', 'The Owner') as own \gset
select tests.name_owner(:'own');
select tests.act_as(:'r1');
select tests.note(:'croom', 3, repeat('Rita says something worth reporting. ', 20), 'public') as bad \gset
select tests.note(:'croom', 3, 'Rita, private', 'private') as rita_priv \gset
reset role;

select tests.act_as(:'rep');
select is(public.report_note(:'bad', 'spam', '  It is spam.  '), '{"reported": true}'::jsonb, 'report_note answers reported');
select is(public.report_note(:'bad', 'harassment'), '{"reported": true}'::jsonb, 'a second report answers the same');
reset role;
select is((select count(*)::int from tests.reports(:'rep', :'bad')), 1, 'and makes no second row');
select is((select body from tests.reports(:'rep', :'bad')), E'Notes report: spam\n\nIt is spam.', 'the body: the reason and her text');
select is((select array(select jsonb_object_keys(context) order by 1) from tests.reports(:'rep', :'bad')),
  array['author', 'chapter', 'excerpt', 'note', 'room', 'section', 'visibility'], 'the context''s keys');
select is((select context from tests.reports(:'rep', :'bad')) - 'excerpt',
  jsonb_build_object('room', :'croom', 'chapter', 3, 'section', tests.sec(:'croom', 3), 'note', :'bad', 'author', :'r1',
                     'visibility', 'public'),
  'the context: room, chapter, note, author, level');
select is(char_length((select context ->> 'excerpt' from tests.reports(:'rep', :'bad'))), 300, 'the excerpt: 300 characters at most');
select tests.act_as(:'rep');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'rita_priv', 'spam')), 'PT404 not_found',
  'a note she cannot see: not_found');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'bad', 'boring')), '22023 invalid_reason', 'an unknown reason');
select is(tests.outcome(format('select public.report_note(%L, %L, %L)', :'bad', 'other', repeat('x', 1001))),
  '22023 report_text_too_long', 'her text: 1000 characters at most');
select tests.act_as(:'r1');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'bad', 'spam')), '22023 report_self', 'not her own note');
reset role;
select tests.fill_feedback(:'rep2', 5);
select tests.act_as(:'rep2');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'bad', 'spam')), 'PT429 rate_limited',
  'the feedback limiter applies (5 an hour)');

-- The owner's functions are hers alone.
select is(tests.outcome('select public.owner_set_notes_public(false)'), '42501 not_owner', 'owner_set_notes_public: not_owner');
select is(tests.outcome(format('select public.owner_remove_note(%L, %L)', :'bad', 'spam')), '42501 not_owner',
  'owner_remove_note: not_owner');
select tests.act_as(:'own');
select is(public.owner_set_notes_public(false), '{"publicEnabled": false}'::jsonb, 'the owner turns Everyone off');
select tests.act_as(:'rep');
select is(public.notes_config(), '{"publicEnabled": false}'::jsonb, 'notes_config says so');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'bad', '❤️')), 'PT404 not_found',
  'Everyone off: a public note of a stranger is out of her sight');
select tests.act_as(:'own');
select is(public.owner_set_notes_public(true), '{"publicEnabled": true}'::jsonb, 'and on again');
select tests.act_as(:'rep');
select public.react_to_note(:'bad', '❤️');
select tests.act_as(:'own');
select is(tests.outcome(format('select public.owner_remove_note(%L, %L)', :'bad', '  ')), '22023 invalid_reason', 'a removal needs a reason');
select is(public.owner_remove_note(:'bad', 'Spam, reported'), '{"removed": true}'::jsonb, 'the owner removes the note');
select is(tests.outcome(format('select public.owner_remove_note(%L, %L)', :'bad', 'again')), 'PT404 not_found', 'once');
reset role;
select is(tests.log_of(:'bad') - 'id' - 'removed_at',
  jsonb_build_object('action', 'remove_note', 'message_id', :'bad', 'room_id', :'croom', 'author_id', :'r1', 'removed_by', :'own',
                     'reason', 'Spam, reported', 'body', repeat('Rita says something worth reporting. ', 20),
                     'visibility', 'public'),
  'the record: its text, its level, the reason, who removed it');
select is(array[tests.msg(:'bad') ->> 'body', tests.msg(:'bad') ->> 'moderated', (tests.msg(:'bad') ->> 'deleted_at' is not null)::text],
  array['', 'true', 'true'], 'the note is a tombstone, moderated, its text gone');
select is(tests.reactions_on(:'bad'), 0, 'its reactions gone');
select tests.act_as(:'r1');
select (select m from jsonb_array_elements(public.note_messages(:'croom', tests.sec(:'croom', 3))) m where m ->> 'id' = :'bad') as bad_json \gset
reset role;
select is(:'bad_json'::jsonb ->> 'kind', 'moderated', 'the author sees "Removed by the moderator"');
select is(:'bad_json'::jsonb -> 'body', 'null'::jsonb, 'without its text');

-- The record's purge: older than 12 months only.
insert into private.note_moderation_log (message_id, room_id, author_id, reason, body, visibility, removed_at)
values (gen_random_uuid(), :'croom', :'r1', 'old', 'old body', 'public', now() - interval '13 months'),
       (gen_random_uuid(), :'croom', :'r1', 'recent', 'recent body', 'public', now() - interval '11 months');
select cmp_ok(private.purge_note_moderation_log(), '>=', 1, 'the purge deletes the old record');
select is((select array_agg(reason order by reason collate "C") from private.note_moderation_log where author_id = :'r1'),
  array['Spam, reported', 'recent'], 'and keeps the ones of the last 12 months');
select ok(not exists (select 1 from pg_extension where extname = 'pg_cron')
          or exists (select 1 from cron.job where jobname = 'purge-note-moderation-log' and schedule = '40 3 1 * *'
                       and command = 'select private.purge_note_moderation_log()'),
  'pg_cron runs it monthly');

-- ------------------------------------------------------------------------- 8. block() and the photo

-- T writes a public note; T2 a friends note; U writes nothing. All three have private profiles. V and W
-- are strangers to them.
select tests.member('t@rules.test', 'Tara') as t \gset
select tests.member('t2@rules.test', 'Tom') as t2 \gset
select tests.member('u@rules.test', 'Uma') as u \gset
select tests.member('v@rules.test', 'Vera') as v \gset
select tests.member('w@rules.test', 'Wim') as w2 \gset
select tests.act_as(x), public.set_private(true) from unnest(array[:'t', :'t2', :'u']::uuid[]) x;
select tests.act_as(x), public.add_to_library(tests.snap('Chapter Book', 384)) from unnest(array[:'t', :'t2']::uuid[]) x;
reset role;
select tests.act_as(:'t');
select tests.note(:'croom', 4, 'Tara, for everyone', 'public') as t_pub \gset
select tests.act_as(:'t2');
select tests.note(:'croom', 4, 'Tom, for friends', 'friends') as t2_fr \gset
reset role;

select is(private.can_see_photo(:'w2', :'u'), false, 'can_see_photo: a private stranger''s photo stays hidden (as before)');
select is(private.can_see_photo(:'w2', :'t'), true, 'through a public note she can see: its author''s photo shows');
select is(private.can_see_photo(:'w2', :'t2'), false, 'not through a friends note of someone not her friend');
select tests.act_as(:'w2');
select is(public.can_see_member_folder(:'t'::text), true, 'the avatars bucket''s read rule follows');
select is(public.can_see_member_folder(:'u'::text), false, 'and still refuses the stranger');
reset role;
select tests.switch(false);
select is(private.can_see_photo(:'w2', :'t'), false, 'Everyone off: not any more');
select tests.switch(true);

select tests.act_as(:'v');
select is(tests.outcome(format('select public.block(%L)', :'u')), 'PT404 not_found',
  'block: a stranger with a private profile and no note: not_found (as before)');
select is(tests.outcome(format('select public.block(%L)', :'t2')), 'PT404 not_found',
  'a friends note she cannot see does not open it');
select is(tests.outcome(format('select public.block(%L)', :'t')), 'ok', 'the author of a public note she can see: blocked');
reset role;
select ok(exists (select 1 from public.blocks where blocker_id = :'v' and blocked_id = :'t'), 'the block is there');
select is(private.can_see_photo(:'v', :'t'), false, 'across the block, no photo through the note');
select is(private.can_see_note(:'v', :'t_pub'), false, 'and no note');
select tests.act_as(:'t');
select is(tests.outcome(format('select public.block(%L)', :'v')), 'PT404 not_found',
  'the one blocked cannot block back through the note (she was blocked first: not_found, as for a stranger)');
select tests.act_as(:'t');
select public.delete_note(:'t_pub');
reset role;
select is(private.can_see_photo(:'w2', :'t'), false, 'a deleted public note shows no photo');

-- ------------------------------------------------------------------------- 10. account deletion

select tests.member('d@rules.test', 'Dora') as d \gset
select tests.member('g@rules.test', 'Gil') as g \gset
select tests.follow(:'d', :'g'), tests.follow(:'g', :'d');
select tests.act_as(x), public.add_to_library(tests.snap('Chapter Book', 384)) from unnest(array[:'d', :'g']::uuid[]) x;
select tests.act_as(:'d');
select (public.add_to_library(tests.snap('Dora sets these', 120))).id as d_e \gset
reset role;
select tests.act_as(:'d');
select public.set_book_chapters(tests.book_of(:'d_e'), 3) -> 'room' ->> 'id' as droom \gset
select tests.note(:'croom', 5, 'Dora, for friends', 'friends') as d_note \gset
select tests.note(:'croom', 5, 'Dora, to be removed', 'public') as d_removed \gset
select public.set_note_chapter(:'croom', 9);
select public.mark_notes_read(:'croom', tests.sec(:'croom', 5), null);
select tests.act_as(:'g');
select tests.note(:'croom', 5, 'Gil answers Dora', 'friends', :'d_note') as g_reply \gset
select tests.act_as(:'d');
select public.react_to_note(:'g_reply', '🔥');
select tests.act_as(:'own');
select public.owner_remove_note(:'d_removed', 'test');
reset role;
select is(tests.of_member(:'d'), '{"notes": 2, "reactions": 1, "positions": 1, "cursors": 1, "log": 1, "calls": 3}'::jsonb,
  'Dora has notes, a reaction, a hand, a cursor, a moderation record and three limited calls (chapters, a reaction, Everyone)');
select tests.act_as(:'d');
select public.delete_my_account();
reset role;
select is(tests.of_member(:'d'), '{"notes": 0, "reactions": 0, "positions": 0, "cursors": 0, "log": 0, "calls": 0}'::jsonb,
  'her account deleted: her notes, reactions, hand, cursors, records and calls go with it');
select is(tests.msg(:'g_reply') ->> 'body', 'Gil answers Dora', 'Gil''s reply to her note stays');
select is(tests.msg(:'g_reply') -> 'reply_to', 'null'::jsonb, 'without its link');
select is(tests.set_by(:'droom'), null::uuid, 'the room she set the chapters of stays, without her name');
select tests.act_as(:'g');
select is((select m -> 'quote' from jsonb_array_elements(public.note_messages(:'croom', tests.sec(:'croom', 5))) m
            where m ->> 'id' = :'g_reply'), 'null'::jsonb, 'and it quotes nothing');
reset role;

-- Everything deferred holds at commit.
select is(tests.outcome('set constraints all immediate'), 'ok', 'every deferred check of this file passes');

select * from finish();
rollback;
