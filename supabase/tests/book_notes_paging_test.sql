-- Notes: a page of a chapter never loses a note at its edge, and the Book page's chapter range counts chapters
-- (migration 20261117010000_notes_page_keyset.sql; found by the import proof, P2 and P5):
--   supabase test db
--
-- note_messages pages on the keyset (created_at, id): 130 notes at ONE instant, paged by 50, come back exactly once each, in
-- order, with 40 hidden notes (Only me) at the same instant in the mix: a hidden note takes no place in a page and does not
-- show through its size. The old cursor (created_at only) is still answered as before, for a client that has not been
-- updated. notes_summary's range is the numbered chapters: a 12-chapter book reads 12, never 13 (The whole book is not
-- chapter 13), and a note on the whole book alone has no range.
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(20);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-NOTES-3', 'book notes paging test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-NOTES-3', 'name', p_name)), now(), now(), now());
  return v_id;
end;
$$;
create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create or replace function tests.snap(p_title text, p_pages integer default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9850000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text,
    'page_count', p_pages))
$$;
create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
  on conflict (follower_id, followee_id) do update set accepted_at = now(), declined_at = null
$$;
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$
  select book_id from public.library_entries where id = p_entry
$$;
create or replace function tests.sec(p_room uuid, p_position integer)
returns uuid language sql security definer as $$
  select id from public.room_sections where room_id = p_room and position = p_position
$$;
-- p_n notes of one author in one chapter, ALL at the same instant (the way an import of second-resolution times makes them).
create or replace function tests.tied(p_room uuid, p_position integer, p_author uuid, p_n integer, p_visibility text, p_at timestamptz)
returns void language sql security definer as $$
  insert into public.room_messages (room_id, section_id, author_id, client_id, body, visibility, created_at)
  select p_room, tests.sec(p_room, p_position), p_author, gen_random_uuid(), p_visibility || ' ' || k, p_visibility, p_at
    from generate_series(1, p_n) k
$$;
create or replace function tests.end_of(p_room uuid)
returns uuid language sql security definer as $$
  select id from public.room_sections where room_id = p_room and kind = 'end'
$$;
create or replace function tests.ids_at(p_section uuid, p_visibility text)
returns uuid[] language sql security definer as $$
  select coalesce(array_agg(id order by id desc), '{}') from public.room_messages where section_id = p_section and visibility = p_visibility
$$;
-- Every note of a chapter the way a client pages it: p_size at a time, the cursor the last note's (createdAt, id); the ids in the order
-- they came, and how many pages it took.
create or replace function tests.walk(p_room uuid, p_section uuid, p_size integer, p_with_id boolean default true)
returns jsonb language plpgsql as $$
declare
  v_page jsonb;
  v_ids  jsonb := '[]';
  v_pages integer := 0;
  v_before timestamptz;
  v_before_id uuid;
begin
  loop
    v_page := public.note_messages(p_room, p_section, v_before, p_size, case when p_with_id then v_before_id end);
    exit when jsonb_array_length(v_page) = 0 or v_pages >= 20;
    v_pages := v_pages + 1;
    v_ids := v_ids || (select jsonb_agg(x -> 'id') from jsonb_array_elements(v_page) x);
    v_before := (v_page -> (jsonb_array_length(v_page) - 1) ->> 'createdAt')::timestamptz;
    v_before_id := (v_page -> (jsonb_array_length(v_page) - 1) ->> 'id')::uuid;
    exit when jsonb_array_length(v_page) < p_size;
  end loop;
  return jsonb_build_object('ids', v_ids, 'pages', v_pages);
end;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('a@paging.test', 'Ada A') as a \gset
select tests.member('f@paging.test', 'Finn F') as f \gset
select tests.member('s@paging.test', 'Sam S') as s \gset
select tests.follow(:'a', :'f');
select tests.follow(:'f', :'a');

select tests.act_as(:'a');
select (public.add_to_library(tests.snap('Paging Book', 300))).id as a_e \gset
select (public.add_to_library(tests.snap('Whole Book Only', 300))).id as a_e2 \gset
select tests.act_as(:'f');
select (public.add_to_library(tests.snap('Paging Book', 300))).id as f_e \gset
reset role;
select tests.book_of(:'a_e') as book \gset
select tests.book_of(:'a_e2') as book2 \gset
select tests.act_as(:'a');
select public.set_book_chapters(:'book', 12) -> 'room' ->> 'id' as room \gset
select public.set_book_chapters(:'book2', 3) -> 'room' ->> 'id' as room2 \gset
reset role;
select tests.sec(:'room', 1) as ch1 \gset

-- ------------------------------------------------------------------------- paging at one instant

-- 130 notes for her friends and 40 for nobody but her, all at one instant: 170 rows tied.
select tests.tied(:'room', 1, :'a', 130, 'friends', '2026-11-01 10:00:00+00');
select tests.tied(:'room', 1, :'a', 40, 'private', '2026-11-01 10:00:00+00');
select is((select count(*)::int from public.room_messages where section_id = :'ch1' and created_at = '2026-11-01 10:00:00+00'), 170,
  'the fixture: 170 notes at one instant');

select tests.act_as(:'f');
select tests.walk(:'room', :'ch1', 50) as friend_walk \gset
reset role;
select is(jsonb_array_length(:'friend_walk'::jsonb -> 'ids'), 130, 'her friend pages 130 notes by 50 and gets 130');
select is((select count(distinct x)::int from jsonb_array_elements_text(:'friend_walk'::jsonb -> 'ids') x), 130, 'each of them once');
select is((:'friend_walk'::jsonb ->> 'pages')::int, 3, 'in 3 pages (50, 50, 30)');
select is(array(select x::uuid from jsonb_array_elements_text(:'friend_walk'::jsonb -> 'ids') x), tests.ids_at(:'ch1', 'friends'),
  'in the thread''s order, the instant then the id, newest first');
select is(array(select x::uuid from jsonb_array_elements_text(:'friend_walk'::jsonb -> 'ids') x
                 where x::uuid = any (tests.ids_at(:'ch1', 'private'))), '{}'::uuid[], 'and not one of the 40 hidden notes');

select tests.act_as(:'f');
select is(jsonb_array_length(public.note_messages(:'room', :'ch1', null, 50)), 50, 'the first page is a full 50 though 40 hidden notes share its instant');
select is(tests.walk(:'room', :'ch1', 7) -> 'ids', :'friend_walk'::jsonb -> 'ids', 'pages of 7 give the same notes in the same order');
select is(tests.walk(:'room', :'ch1', 100) -> 'ids', :'friend_walk'::jsonb -> 'ids', 'pages of 100 do too');
select is((tests.walk(:'room', :'ch1', 100) ->> 'pages')::int, 2, 'a page is at most 100: 130 notes are 100 and 30');
reset role;

select tests.act_as(:'a');
select tests.walk(:'room', :'ch1', 50) as author_walk \gset
reset role;
select is(jsonb_array_length(:'author_walk'::jsonb -> 'ids'), 170, 'the author pages all 170 (her hidden ones are hers) by 50');
select is((select count(distinct x)::int from jsonb_array_elements_text(:'author_walk'::jsonb -> 'ids') x), 170, 'each once');

select tests.act_as(:'s');
select is(tests.walk(:'room', :'ch1', 50) -> 'ids', '[]'::jsonb, 'a stranger pages nothing');
reset role;

-- A mix: some of the tied notes are older, some newer than the others.
select tests.tied(:'room', 1, :'a', 60, 'friends', '2026-11-01 09:00:00+00');
select tests.tied(:'room', 1, :'a', 60, 'friends', '2026-11-01 11:00:00+00');
select tests.act_as(:'f');
select tests.walk(:'room', :'ch1', 50) as mix_walk \gset
reset role;
select is(jsonb_array_length(:'mix_walk'::jsonb -> 'ids'), 250, 'three instants of 60, 130 and 60 friends'' notes: 250 of 250');
select is((select count(distinct x)::int from jsonb_array_elements_text(:'mix_walk'::jsonb -> 'ids') x), 250, 'each once');

-- The old cursor still answers as before (a client that has not been updated): the notes after a tie are the ones it loses.
select tests.act_as(:'f');
select ok(jsonb_array_length(tests.walk(:'room', :'ch1', 50, false) -> 'ids') < 250, 'the old cursor (no p_before_id) is unchanged: it skips what ties at an edge');
select is(jsonb_array_length(public.note_messages(:'room', :'ch1', '2026-11-01 11:00:00+00', 5)), 5,
  'created_at < p_before alone still answers (a 5-note page of the older notes)');
reset role;

-- ------------------------------------------------------------------------- the chapter range of the Book page

select tests.act_as(:'a');
select tests.sec(:'room', 3) as ch3 \gset
select tests.sec(:'room', 12) as ch12 \gset
select tests.end_of(:'room') as whole \gset
select public.post_note(:'room', :'ch3', gen_random_uuid(), 'in chapter 3', 'friends') as _ \gset
select public.post_note(:'room', :'ch12', gen_random_uuid(), 'in chapter 12', 'friends') as _ \gset
select public.post_note(:'room', :'whole', gen_random_uuid(), 'about the whole book', 'friends') as _ \gset
select tests.act_as(:'f');
select public.notes_summary(:'book') as summary \gset
reset role;
select is((:'summary'::jsonb -> 'friends' ->> 'lastChapter')::int, 12, 'a 12-chapter book reads chapter 12 as its last, not 13');
select is((:'summary'::jsonb -> 'friends' ->> 'firstChapter')::int, 1, 'and its first is the first numbered chapter with a note (the 130 notes in chapter 1)');

select tests.act_as(:'a');
select public.post_note(:'room2', tests.end_of(:'room2'), gen_random_uuid(), 'only the whole book', 'friends') as _ \gset
select tests.act_as(:'f');
select (public.add_to_library(tests.snap('Whole Book Only', 300))).id as f_e2 \gset
select public.notes_summary(:'book2') as summary2 \gset
reset role;
select is(:'summary2'::jsonb -> 'friends' -> 'lastChapter', 'null'::jsonb, 'a note on the whole book alone has no chapter range');

select * from finish();
rollback;
