-- Notes on a Book, N1: every client call as the real role, with the commit's checks (migration
-- 20261116010000_book_notes.sql):
--   supabase test db
--
-- A pgTAP file is one transaction that never commits, so a DEFERRED trigger never fires in it, and the
-- other Notes files call the functions while the test runs as postgres between them. In the app the
-- caller is `authenticated`, and the deferred checks (private.room_sections_order,
-- private.room_messages_replies_check) fire at COMMIT, after the security definer function has returned,
-- as `authenticated`, which may read none of the Notes tables. Here every client call runs as a signed-in
-- member and is followed, still as that member, by `set constraints all immediate`: the deferred triggers
-- fire right there, as at a real commit. Each must answer ok.

begin;
select plan(26);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-NOTES-3', 'book notes as a member', 10);

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
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

-- The commit's checks, as whoever runs it: the deferred triggers fire now; then deferred again, so the
-- next call's checks wait for the next commit point.
create or replace function tests.commit_point()
returns text language plpgsql as $$
declare v text := 'ok';
begin
  begin
    set constraints all immediate;
  exception when others then
    v := sqlstate || ' ' || sqlerrm;
  end;
  set constraints all deferred;
  return current_user || ': ' || v;
end;
$$;

create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
    'apple_id', (9850000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text, 'page_count', 300)
$$;
create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
$$;
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;
create or replace function tests.switch(p_on boolean)
returns void language sql security definer as $$
  update private.notes_settings set public_enabled = p_on
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('m@as-member.test', 'Mia') as m \gset
select tests.member('k@as-member.test', 'Kai') as k \gset
select tests.member('o@as-member.test', 'Owen') as own \gset
select tests.follow(:'m', :'k'), tests.follow(:'k', :'m');
select tests.name_owner(:'own');
select tests.switch(true);

select tests.act_as(:'m');
select (public.add_to_library(tests.snap('As a member'))).book_id as book \gset
select tests.act_as(:'k');
select public.add_to_library(tests.snap('As a member'));

-- Chapters.
select tests.act_as(:'m');
select public.set_book_chapters(:'book', 5) -> 'room' ->> 'id' as room \gset
select is(tests.commit_point(), 'authenticated: ok', 'set_book_chapters commits as a member');
select is((public.add_book_chapters(:'room', 2) -> 'room' ->> 'chapterCount')::int, 7, 'add_book_chapters');
select is(tests.commit_point(), 'authenticated: ok', 'add_book_chapters commits as a member');
select (select c ->> 'id' from jsonb_array_elements(public.book_notes(:'book') -> 'room' -> 'chapters') c
         where (c ->> 'position')::int = 1) as ch1 \gset
select is(tests.commit_point(), 'authenticated: ok', 'book_notes commits as a member');
select is(public.set_note_chapter(:'room', 3) ->> 'chapter', '3', 'set_note_chapter');
select is(tests.commit_point(), 'authenticated: ok', 'set_note_chapter commits as a member');

-- Notes, a reply, a reply to the reply.
select public.post_note(:'room', :'ch1', gen_random_uuid(), 'Mia, public', 'public') ->> 'id' as n1 \gset
select is(tests.commit_point(), 'authenticated: ok', 'post_note commits as a member');
select tests.act_as(:'k');
select public.post_note(:'room', :'ch1', gen_random_uuid(), 'Kai answers', 'public', :'n1') ->> 'id' as r1 \gset
select tests.act_as(:'m');
select public.post_note(:'room', :'ch1', gen_random_uuid(), 'Mia answers Kai', 'friends', :'r1') ->> 'id' as r2 \gset
select is(tests.commit_point(), 'authenticated: ok', 'replies commit as a member');

-- Narrowing (the replies too: the deferred replies check fires), widening.
select is(public.set_note_visibility(:'n1', 'private') ->> 'visibility', 'private', 'set_note_visibility narrows');
select is(tests.commit_point(), 'authenticated: ok', 'narrowing with its replies commits as a member');
select is(public.set_note_visibility(:'n1', 'friends') ->> 'visibility', 'friends', 'and widens');
select is(tests.commit_point(), 'authenticated: ok', 'widening commits as a member');

-- Reading, reacting, reporting, the cursor, the summary.
select tests.act_as(:'k');
select ok(jsonb_array_length(public.note_messages(:'room', :'ch1')) >= 1, 'note_messages');
select public.react_to_note(:'n1', '❤️');
select is(tests.commit_point(), 'authenticated: ok', 'react_to_note commits as a member');
select is(public.report_note(:'n1', 'spam'), '{"reported": true}'::jsonb, 'report_note');
select is(tests.commit_point(), 'authenticated: ok', 'report_note commits as a member');
select ok(public.mark_notes_read(:'room', :'ch1', null) ? 'lastReadAt', 'mark_notes_read');
select is(tests.commit_point(), 'authenticated: ok', 'mark_notes_read commits as a member');
select ok(public.notes_summary(:'book') ? 'friends', 'notes_summary');
select is(tests.commit_point(), 'authenticated: ok', 'notes_summary and notes_config commit as a member');

-- Deleting.
select public.delete_note(:'r1');
select is(tests.commit_point(), 'authenticated: ok', 'delete_note commits as a member');

-- The owner's functions.
select tests.act_as(:'own');
select is(public.owner_set_chapter_count(:'room', 6) ->> 'chapterCount', '6', 'owner_set_chapter_count');
select is(tests.commit_point(), 'authenticated: ok', 'owner_set_chapter_count commits as the owner');
select is(public.owner_remove_note(:'r2', 'test'), '{"removed": true}'::jsonb, 'owner_remove_note');
select is(public.owner_set_notes_public(true), '{"publicEnabled": true}'::jsonb, 'owner_set_notes_public');
select is(tests.commit_point(), 'authenticated: ok', 'the owner''s removal and switch commit as the owner');
reset role;

select * from finish();
rollback;
