-- Notes: voice notes, for your own private notes (20261118010000_notes_private_voice.sql):
--   supabase test db
--
-- A member records a voice note in a chapter of a Book's Notes at Only me and posts it with post_note_voice (the object was uploaded
-- to the private bucket `note-voice` first). Every call below runs as the real role (`authenticated`) and is followed, as that role,
-- by `set constraints all immediate`, so the deferred trigger of the replies check fires as it does at a real commit.
--
-- What is proved: the author posts, reads, hears, replies to herself and deletes; nobody else (a mutual friend, a member of Everyone, a
-- stranger who has no Book, a member blocked with her, the owner, a signed-out caller) can see the note, count it, fetch its row, hear
-- it or sign a URL for it (the storage select policy answers nothing), react to it, report it, change its level or delete it; it can
-- never be widened (voice_private_only, and the table's own check as a backstop); post_note refuses a voice client id; the reply
-- rules; the caps (type, length, waveform, 3 MB, 10 a minute, the 30 a minute of every note) and the hourly upload cap; her own delete,
-- the owner's removal and her account's deletion queue the object (bucket note-voice) and the sweep hands it out, removes the
-- orphans older than the grace and leaves attached objects, and the buddy side of the queue never sees a note-voice path.
-- Assertions ask about rows this test made, never counts of a table.

begin;
select plan(141);

create schema if not exists tests;
select set_config('storage.allow_delete_query', 'true', true);

insert into public.invite_codes (code, label, max_uses) values ('T-NOTE-VOICE-1', 'note voice test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-NOTE-VOICE-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.act_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;

-- The commit's checks, as whoever runs it: the deferred triggers fire now; then deferred again.
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
    'apple_id', (9860000000 + ('x' || substr(md5(p_title), 1, 7))::bit(28)::int)::text, 'page_count', 300)
$$;
create or replace function tests.follow(p_follower uuid, p_followee uuid)
returns void language sql security definer as $$
  insert into public.follows (follower_id, followee_id, accepted_at) values (p_follower, p_followee, now())
$$;
create or replace function tests.block(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;
create or replace function tests.switch(p_on boolean)
returns void language sql security definer as $$
  update private.notes_settings set public_enabled = p_on
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

-- The name of an object: author / room / client id . extension.
create or replace function tests.path(p_author uuid, p_room uuid, p_client uuid, p_ext text default 'm4a')
returns text language sql as $$ select p_author || '/' || p_room || '/' || p_client || '.' || p_ext $$;

-- An object put in the bucket past RLS (what an upload leaves behind), at an age.
create or replace function tests.obj(p_name text, p_owner uuid, p_mime text default 'audio/mp4',
                                     p_size bigint default 12345, p_age interval default interval '0')
returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
  values ('note-voice', p_name, p_owner::text, jsonb_build_object('mimetype', p_mime, 'size', p_size), now() - p_age)
$$;

-- An upload as the acting member: the insert policy decides. Answers 'ok' or the sqlstate.
create or replace function tests.upload(p_name text, p_owner uuid, p_mime text default 'audio/mp4', p_size bigint default 12345)
returns text language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('note-voice', p_name, p_owner::text, jsonb_build_object('mimetype', p_mime, 'size', p_size));
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- How many of these objects the acting member may see (and so sign a URL for): the select policy decides.
create or replace function tests.heard(p_name text)
returns integer language sql as $$
  select count(*)::integer from storage.objects where bucket_id = 'note-voice' and name = p_name
$$;

-- Past RLS.
create or replace function tests.bucket_row()
returns text language sql security definer as $$
  select (public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'note-voice'
$$;
create or replace function tests.obj_there(p_name text)
returns boolean language sql security definer as $$
  select exists (select 1 from storage.objects where bucket_id = 'note-voice' and name = p_name)
$$;
create or replace function tests.age_obj(p_name text, p_age interval)
returns void language sql security definer as $$
  update storage.objects set created_at = now() - p_age where bucket_id = 'note-voice' and name = p_name
$$;
create or replace function tests.in_trash(p_bucket text, p_name text)
returns boolean language sql security definer as $$
  select exists (select 1 from private.buddy_voice_trash where bucket = p_bucket and path = p_name)
$$;
create or replace function tests.row_of(p_id uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.room_messages m where m.id = p_id
$$;
create or replace function tests.visible_to(p_viewer uuid, p_room uuid, p_id uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from private.visible_notes(p_viewer, p_room) n where n.id = p_id)
$$;
create or replace function tests.can_see(p_viewer uuid, p_id uuid)
returns boolean language sql security definer as $$ select private.can_see_note(p_viewer, p_id) $$;
create or replace function tests.fill_calls(p_member uuid, p_kind text, p_n integer)
returns void language sql security definer as $$
  insert into private.note_calls (member_id, kind) select p_member, p_kind from generate_series(1, p_n)
$$;
create or replace function tests.clear_calls(p_member uuid)
returns void language sql security definer as $$
  delete from private.note_calls where member_id = p_member
$$;
create or replace function tests.fill_objects(p_owner uuid, p_room uuid, p_n integer)
returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'note-voice', p_owner || '/' || p_room || '/' || gen_random_uuid() || '.m4a', p_owner::text, '{"mimetype":"audio/mp4","size":777}'::jsonb
    from generate_series(1, p_n)
$$;
create or replace function tests.clear_objects(p_owner uuid)
returns void language sql security definer as $$
  delete from storage.objects where bucket_id = 'note-voice' and owner_id = p_owner::text and (metadata ->> 'size') = '777'
$$;
create or replace function tests.queue(p_bucket text, p_path text)
returns void language sql security definer as $$
  insert into private.buddy_voice_trash (bucket, path, queued_at) values (p_bucket, p_path, clock_timestamp()) on conflict do nothing
$$;
create or replace function tests.attempts(p_bucket text, p_path text)
returns integer language sql security definer as $$
  select attempts from private.buddy_voice_trash where bucket = p_bucket and path = p_path
$$;
-- A raw insert past the API: what the table's checks and trigger say (sqlstate or ok).
create or replace function tests.raw_voice(p_room uuid, p_section uuid, p_author uuid, p_visibility text, p_kind text default 'voice')
returns text language plpgsql security definer as $$
declare v_client uuid := gen_random_uuid();
begin
  insert into public.room_messages (room_id, section_id, author_id, client_id, kind, body, visibility,
                                    voice_object, voice_mime, voice_duration_ms)
  values (p_room, p_section, p_author, v_client, p_kind, '', p_visibility,
          p_author || '/' || p_room || '/' || v_client || '.m4a', 'audio/mp4', 1000);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- One voice note posted as the acting member: the object is put in the bucket past RLS (the upload is tested on its own), then the call.
create or replace function tests.say(p_room uuid, p_section uuid, p_client uuid, p_reply uuid default null, p_mime text default 'audio/mp4')
returns jsonb language plpgsql as $$
declare
  v_me   uuid := auth.uid();
  v_path text := v_me || '/' || p_room || '/' || p_client || '.' || case p_mime when 'audio/mp4' then 'm4a' when 'audio/webm' then 'webm' else 'ogg' end;
begin
  perform tests.obj(v_path, v_me, p_mime);
  return public.post_note_voice(p_room, p_section, p_client, v_path, p_mime, 4200, array[10, 40, 90, 20]::smallint[], p_reply);
end;
$$;

grant usage on schema tests to authenticated, anon, service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- ------------------------------------------------------------------ the cast
-- m: the author. k: her mutual friend. p: a member of Everyone (follows nobody, no friend). s: a stranger without the Book.
-- b: blocked with m, who has the Book. o: the owner of the instance. d: a member whose account is deleted at the end.

select tests.member('m@note-voice.test', 'Mia') as m \gset
select tests.member('k@note-voice.test', 'Kai') as k \gset
select tests.member('p@note-voice.test', 'Pia') as p \gset
select tests.member('s@note-voice.test', 'Sam') as s \gset
select tests.member('b@note-voice.test', 'Bo') as b \gset
select tests.member('o@note-voice.test', 'Owen') as own \gset
select tests.member('d@note-voice.test', 'Dee') as d \gset
select tests.follow(:'m', :'k'), tests.follow(:'k', :'m');
select tests.block(:'m', :'b');
select tests.name_owner(:'own');
select tests.switch(true);

select tests.act_as(:'m');
select (public.add_to_library(tests.snap('Voice of Notes'))).book_id as book \gset
select tests.act_as(:'k');
select public.add_to_library(tests.snap('Voice of Notes'));
select tests.act_as(:'p');
select public.add_to_library(tests.snap('Voice of Notes'));
select tests.act_as(:'b');
select public.add_to_library(tests.snap('Voice of Notes'));
select tests.act_as(:'d');
select public.add_to_library(tests.snap('Voice of Notes'));

select tests.act_as(:'m');
select public.set_book_chapters(:'book', 4) -> 'room' ->> 'id' as room \gset
select (select c ->> 'id' from jsonb_array_elements(public.book_notes(:'book') -> 'room' -> 'chapters') c
         where (c ->> 'position')::int = 1) as ch1 \gset
select (select c ->> 'id' from jsonb_array_elements(public.book_notes(:'book') -> 'room' -> 'chapters') c
         where (c ->> 'position')::int = 2) as ch2 \gset
select (select c ->> 'id' from jsonb_array_elements(public.book_notes(:'book') -> 'room' -> 'chapters') c
         where (c ->> 'position')::int = 3) as ch3 \gset
select tests.act_as(:'k');
select public.set_note_chapter(:'room', 4);
select tests.act_as(:'p');
select public.set_note_chapter(:'room', 4);
select tests.act_as(:'b');
select public.set_note_chapter(:'room', 4);
select tests.act_as(:'m');
select public.set_note_chapter(:'room', 4);

select gen_random_uuid() as c1, gen_random_uuid() as c2, gen_random_uuid() as c3, gen_random_uuid() as c4, gen_random_uuid() as c5, gen_random_uuid() as c6 \gset

-- ------------------------------------------------------------------ the bucket

select is(tests.bucket_row(),
          '(f,3145728,"{audio/mp4,audio/webm,audio/ogg}")', 'the bucket is private, 3 MB, the three types');

-- ------------------------------------------------------------------ the upload policy

select tests.act_as(:'m');
select is(tests.upload(tests.path(:'m', :'room', :'c1'), :'m'), 'ok', 'upload: her own folder of a Notes room of a Book she has');
select is(tests.upload(tests.path(:'m', :'room', gen_random_uuid(), 'wav'), :'m'), '42501', 'upload: a name with another extension is refused');
select is(tests.upload('x/y.m4a', :'m'), '42501', 'upload: a name that is no object name is refused');
select is(tests.upload(tests.path(:'k', :'room', gen_random_uuid()), :'m'), '42501', 'upload: another member''s folder is refused');
select is(tests.upload(tests.path(:'m', gen_random_uuid(), gen_random_uuid()), :'m'), '42501', 'upload: a room that is none is refused');
select tests.act_as(:'s');
select is(tests.upload(tests.path(:'s', :'room', gen_random_uuid()), :'s'), '42501', 'upload: a member without the Book may not write into its room');
select tests.act_as(:'k');
select is(tests.upload(tests.path(:'m', :'room', gen_random_uuid()), :'k'), '42501', 'upload: a friend cannot write into her folder');
select tests.act_anon();
select is(tests.upload(tests.path(:'m', :'room', gen_random_uuid()), :'m'), '42501', 'upload: signed out is refused');

-- ------------------------------------------------------------------ the author posts

select tests.act_as(:'m');
select public.post_note_voice(:'room', :'ch1', :'c1', tests.path(:'m', :'room', :'c1'), 'audio/mp4', 4200,
                              array[10, 40, 90, 20]::smallint[]) as v1 \gset
select is(:'v1'::jsonb ->> 'visibility', 'private', 'post_note_voice: private');
select is(:'v1'::jsonb ->> 'body', '', 'post_note_voice: no words');
select is(:'v1'::jsonb -> 'voice' ->> 'path', tests.path(:'m', :'room', :'c1'), 'the answer names the object (to her)');
select is(:'v1'::jsonb -> 'voice' -> 'durationMs', '4200'::jsonb, 'the answer says how long it plays');
select is(:'v1'::jsonb -> 'voice' -> 'peaks', '[10, 40, 90, 20]'::jsonb, 'and the waveform');
select is(:'v1'::jsonb ->> 'mine', 'true', 'and that it is hers');
select is(tests.commit_point(), 'authenticated: ok', 'post_note_voice commits as a member');
select :'v1'::jsonb ->> 'id' as n1 \gset

select is(public.post_note_voice(:'room', :'ch1', :'c1', tests.path(:'m', :'room', :'c1'), 'audio/mp4', 4200, array[10, 40, 90, 20]::smallint[]) ->> 'id',
          :'n1', 'idempotent on the client id: the same call answers the note it made');
select is(jsonb_array_length(public.note_messages(:'room', :'ch1')), 1, 'note_messages: it is in her thread (one row)');
select is((public.note_messages(:'room', :'ch1') -> 0 -> 'voice' ->> 'mime'), 'audio/mp4', 'the thread says it is a voice note, to her');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 1, 'she can hear her own object (the select policy lets her through)');
select is((public.book_notes(:'book') -> 'room' -> 'chapters' -> 0 ->> 'count')::int, 1, 'her chapter counts it');

select is(tests.outcome(format('select public.post_note(%L, %L, %L, %L, %L)', :'room', :'ch1', :'c1', 'a text', 'private')),
          'PT409 client_id_reused', 'post_note: a voice note''s client id is client_id_reused, never answered as text');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch2', :'c1', tests.path(:'m', :'room', :'c1'), 'audio/mp4')),
          'PT409 client_id_reused', 'the same client id for another chapter is client_id_reused');

-- a text note's client id cannot be taken by a voice post
select public.post_note(:'room', :'ch1', :'c2', 'my text', 'private') ->> 'id' as t1 \gset
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c2', tests.path(:'m', :'room', :'c2'), 'audio/mp4')),
          'PT409 client_id_reused', 'a text note''s client id is not a voice post''s');

-- ------------------------------------------------------------------ refusals of the post

select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/mp4')),
          '22023 voice_missing', 'no object at its name: voice_missing');
select tests.obj(tests.path(:'m', :'room', :'c3'), :'m', 'audio/webm');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/mp4')),
          '22023 voice_invalid', 'an object of another type than said: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c3', tests.path(:'k', :'room', :'c3'), 'audio/mp4')),
          '22023 voice_invalid', 'a name that is not hers: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'ch1', :'c3'), 'audio/mp4')),
          '22023 voice_invalid', 'a name in another room: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 4200, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3', 'webm'), 'audio/webm')),
          '22023 voice_missing', 'the name has to be where the type says: another extension finds no object');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 0, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          '22023 voice_invalid', 'no length: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 120001, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          '22023 voice_invalid', 'over two minutes: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, array[101]::smallint[])', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          '22023 voice_invalid', 'a waveform value over 100: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, array[]::smallint[])', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          '22023 voice_invalid', 'an empty waveform: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', :'room', :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/wav')),
          '22023 voice_invalid', 'a type that is none of three: voice_invalid');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', :'room', gen_random_uuid(), :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          'PT404 not_found', 'a chapter that is none: not_found');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', gen_random_uuid(), :'ch1', :'c3', tests.path(:'m', :'room', :'c3'), 'audio/webm')),
          'PT404 not_found', 'a room that is none: not_found');
select tests.obj(tests.path(:'m', :'room', :'c4', 'webm'), :'m', 'audio/webm', 3 * 1024 * 1024 + 1);
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', :'room', :'ch1', :'c4', tests.path(:'m', :'room', :'c4', 'webm'), 'audio/webm')),
          '22023 voice_too_large', 'over 3 MB: voice_too_large');

select tests.act_as(:'s');
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', :'room', :'ch1', gen_random_uuid(), 'x', 'audio/webm')),
          'PT403 notes_need_book', 'without the Book: notes_need_book');
select tests.act_anon();
select is(tests.outcome(format('select public.post_note_voice(%L, %L, %L, %L, %L, 1000, null)', :'room', :'ch1', gen_random_uuid(), 'x', 'audio/webm')),
          '42501 permission denied for function post_note_voice', 'signed out: no execute');
select tests.act_as(:'m');

-- ------------------------------------------------------------------ replies

select public.post_note(:'room', :'ch1', gen_random_uuid(), 'a friends note', 'friends') ->> 'id' as fr \gset
select tests.say(:'room', :'ch1', gen_random_uuid(), :'t1') ->> 'id' as rv \gset
select ok(:'rv' is not null, 'a voice note may answer her own private text note');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid(), %L)', :'room', :'ch1', :'fr')),
          '22023 reply_not_visible', 'a voice note may not answer her own friends note');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid(), %L)', :'room', :'ch2', :'t1')),
          '22023 reply_not_visible', 'nor a note of another chapter');
select tests.act_as(:'k');
select public.post_note(:'room', :'ch1', gen_random_uuid(), 'Kai''s friends note', 'friends') ->> 'id' as kn \gset
select tests.act_as(:'m');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid(), %L)', :'room', :'ch1', :'kn')),
          '22023 reply_not_visible', 'nor a friend''s note');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid(), %L)', :'room', :'ch1', gen_random_uuid())),
          '22023 reply_not_visible', 'nor a note that is none');
select tests.say(:'room', :'ch1', gen_random_uuid(), :'n1') ->> 'id' as rv2 \gset
select ok(:'rv2' is not null, 'a voice note may answer her own private voice note');

select public.post_note(:'room', :'ch1', gen_random_uuid(), 'a text answer', 'private', :'n1') ->> 'id' as ta \gset
select ok(:'ta' is not null, 'a private text note may answer a voice note');
select is((select x -> 'quote' ->> 'excerpt' from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' = :'ta'),
          '', 'the answer to a voice note has a quote, with no words in it');
select is((select x -> 'quote' ->> 'voice' from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' = :'ta'),
          'true', 'the quote of a voice note says it is one');
select is(tests.outcome(format('select public.post_note(%L, %L, gen_random_uuid(), %L, %L, %L)', :'room', :'ch1', 'wide', 'friends', :'n1')),
          '22023 note_wider_than_parent', 'a friends answer to a voice note is wider than its parent');
select is(tests.commit_point(), 'authenticated: ok', 'the answers commit as a member');

-- A chapter where she has only a voice note.
select tests.say(:'room', :'ch3', :'c6') ->> 'id' as v3 \gset
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 2 ->> 'count', '1', 'her own count of the voice-only chapter is 1');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 2 -> 'faces' -> 0 ->> 'name', 'Mia', 'and she is the face in it');

-- ------------------------------------------------------------------ nobody else sees it

select tests.act_as(:'k');
select is((select count(*)::int from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' in (:'n1', :'rv', :'rv2', :'ta')), 0,
          'a mutual friend: not in her thread');
select ok(position(:'n1' in public.note_messages(:'room', :'ch1')::text) = 0 and position(tests.path(:'m', :'room', :'c1') in public.note_messages(:'room', :'ch1')::text) = 0
          and position('durationMs' in public.note_messages(:'room', :'ch1')::text) = 0 and position('audio/mp4' in public.note_messages(:'room', :'ch1')::text) = 0,
          'a friend: the thread holds no id, name, length or type of it');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 0 ->> 'count', '2', 'a friend: the chapter counts Mia''s friends note and Kai''s own, none of the five private ones (voice and text)');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 2 ->> 'count', '0', 'a friend: the chapter where Mia has only a voice note counts nothing');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 2 -> 'faces', '[]'::jsonb, 'a friend: and shows no face in it');
select is((public.notes_summary(:'book') -> 'friends' ->> 'count')::int, 1, 'a friend: the Book page counts her one friends note, no voice note');
select is((public.notes_summary(:'book') -> 'friends' ->> 'lastChapter')::int, 1, 'a friend: and its chapter range is chapter 1 (the voice-only chapter 3 is not in it)');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'a friend cannot see the object, so no URL is signed for her');
select is(tests.outcome(format('select public.react_to_note(%L, %L)', :'n1', '❤️')), 'PT404 not_found', 'a friend cannot react to it');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'n1', 'spam')), 'PT404 not_found', 'a friend cannot report it (she cannot see it)');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'n1', 'public')), 'PT404 not_found', 'a friend cannot change its level (not found, not "voice_private_only")');
select is(tests.outcome(format('select public.delete_note(%L)', :'n1')), 'PT404 not_found', 'a friend cannot delete it');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid(), %L)', :'room', :'ch1', :'n1')),
          '22023 reply_not_visible', 'and cannot answer it by voice');
select is(tests.outcome(format('select public.post_note(%L, %L, gen_random_uuid(), %L, %L, %L)', :'room', :'ch1', 'hi', 'private', :'n1')),
          '22023 reply_not_visible', 'nor by text: a reply to it is not visible to her');

select tests.act_as(:'p');
select is((select count(*)::int from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' in (:'n1', :'rv', :'rv2', :'ta')), 0, 'a member of Everyone: not in her thread');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 0 ->> 'count', '0', 'a member of Everyone: counts none of it (the friends notes are not hers to see either)');
select is(public.book_notes(:'book') -> 'room' -> 'chapters' -> 2 ->> 'count', '0', 'a member of Everyone: the voice-only chapter counts nothing');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'a member of Everyone cannot see the object');
select is((public.notes_summary(:'book') -> 'public' ->> 'count')::int, 0, 'a member of Everyone: the Book page counts none of it');

select tests.act_as(:'s');
select is((select count(*)::int from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x), 0, 'a stranger: nothing in the thread');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'a stranger cannot see the object');
select is(tests.outcome(format('select public.report_note(%L, %L)', :'n1', 'spam')), 'PT404 not_found', 'a stranger cannot report it');

select tests.act_as(:'b');
select is((select count(*)::int from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' in (:'n1', :'rv', :'rv2', :'ta')), 0, 'a blocked member: not in her thread');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'a blocked member cannot see the object');

select tests.act_as(:'own');
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'the owner of the instance cannot see the object either');
select is((select count(*)::int from jsonb_array_elements(public.note_messages(:'room', :'ch1')) x where x ->> 'id' = :'n1'), 0, 'nor the note');

select tests.act_anon();
select is(tests.heard(tests.path(:'m', :'room', :'c1')), 0, 'signed out cannot see the object');
reset role;
select is(tests.can_see(:'k', :'n1'), false, 'can_see_note: not a friend');
select is(tests.can_see(:'p', :'n1'), false, 'can_see_note: not a member of Everyone');
select is(tests.can_see(:'m', :'n1'), true, 'can_see_note: her');
select is(tests.visible_to(:'k', :'room', :'n1'), false, 'visible_notes agrees: not a friend');
select is(tests.visible_to(:'m', :'room', :'n1'), true, 'visible_notes agrees: her');

-- ------------------------------------------------------------------ never wider

select tests.act_as(:'m');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'n1', 'friends')), '22023 voice_private_only', 'widening to Friends is voice_private_only');
select is(tests.outcome(format('select public.set_note_visibility(%L, %L)', :'n1', 'public')), '22023 voice_private_only', 'widening to Everyone is voice_private_only');
select is(public.set_note_visibility(:'n1', 'private') ->> 'visibility', 'private', 'asking for Only me again is no change');
select is(tests.commit_point(), 'authenticated: ok', 'the refusals and the no-op commit as a member');
reset role;
select is(tests.raw_voice(:'room', :'ch1', :'m', 'friends'), '23514', 'the table says no to a voice note at Friends, whoever writes it');
select is(tests.raw_voice(:'room', :'ch1', :'m', 'public'), '23514', 'and at Everyone');
select is(tests.raw_voice(:'room', :'ch1', :'m', 'private'), 'ok', 'and yes at Only me (the check is the backstop, not the way)');
select is(tests.outcome(format('update public.room_messages set visibility = %L where id = %L', 'friends', :'n1')), '23514 voice_private_only',
          'an update that widens it is refused');
select is(tests.outcome(format('update public.room_messages set kind = %L where id = %L', 'voice', :'t1')), '23514 room_message_invalid: a note does not change its kind', 'a note never changes its kind');

-- ------------------------------------------------------------------ the caps

select tests.act_as(:'m');
select tests.clear_calls(:'m');
select tests.fill_calls(:'m', 'voice', 10);
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid())', :'room', :'ch1')), 'PT429 rate_limited', 'the eleventh voice note in a minute: rate_limited');
select tests.clear_calls(:'m');
select tests.fill_calls(:'m', 'voice_day', 100);
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid())', :'room', :'ch1')), 'PT429 rate_limited', 'the hundred and first in a day: rate_limited');
select tests.clear_calls(:'m');
select is(tests.outcome(format('select tests.say(%L, %L, gen_random_uuid())', :'room', :'ch1')), 'ok', 'and the ledger forgotten, she can again');
select tests.clear_objects(:'m');
select tests.fill_objects(:'m', :'room', 20);
select is(tests.upload(tests.path(:'m', :'room', gen_random_uuid()), :'m'), '42501', 'the hourly upload cap: the twenty-first object in an hour is refused');
select tests.clear_objects(:'m');
select is(tests.upload(tests.path(:'m', :'room', gen_random_uuid()), :'m'), 'ok', 'and fine again when they are gone');

-- ------------------------------------------------------------------ the other kind of note is untouched

select is(public.post_note(:'room', :'ch1', gen_random_uuid(), 'plain', 'friends') ->> 'kind', 'note', 'post_note still posts a text note at Friends');
select is(jsonb_exists(public.post_note(:'room', :'ch1', gen_random_uuid(), 'plain 2', 'private'), 'voice'), false, 'and a text note carries no voice key');

-- ------------------------------------------------------------------ delete: a tombstone, the object queued

select tests.act_as(:'m');
select tests.say(:'room', :'ch1', :'c5') ->> 'id' as n3 \gset
select is(tests.in_trash('note-voice', tests.path(:'m', :'room', :'c5')), false, 'a live voice note''s object is not in the queue');
select is(public.delete_note(:'n3') ->> 'kind', 'removed', 'delete_note: a tombstone');
select is(tests.commit_point(), 'authenticated: ok', 'delete_note commits as a member');
select is(tests.in_trash('note-voice', tests.path(:'m', :'room', :'c5')), true, 'deleting queued the object (bucket note-voice)');
select is((tests.row_of(:'n3') ->> 'voice_object') is null and (tests.row_of(:'n3') ->> 'voice_mime') is null and (tests.row_of(:'n3') ->> 'voice_duration_ms') is null, true,
          'the tombstone keeps no audio columns');
select is(tests.heard(tests.path(:'m', :'room', :'c5')), 0, 'and not even she can sign it any more (nothing points at it)');
select is(public.delete_note(:'n3') ->> 'kind', 'removed', 'deleting again changes nothing');

-- ------------------------------------------------------------------ the owner removes one

select tests.say(:'room', :'ch1', gen_random_uuid()) as j4 \gset
select :'j4'::jsonb ->> 'id' as n4, :'j4'::jsonb -> 'voice' ->> 'path' as n4path \gset
select tests.act_as(:'own');
select is(public.owner_remove_note(:'n4', 'test'), '{"removed": true}'::jsonb, 'owner_remove_note works on a voice note');
select is(tests.commit_point(), 'authenticated: ok', 'owner_remove_note commits as the owner');
reset role;
select is(tests.in_trash('note-voice', :'n4path'), true, 'the owner''s removal queued the object');
select is((select body from private.note_moderation_log where message_id = :'n4'), '[voice note, 4 s]', 'the record says "voice note", never the sound');

-- ------------------------------------------------------------------ the sweep

select tests.act_as(:'m');
select is(tests.outcome('select public.voice_sweep_batch()'), '42501 permission denied for function voice_sweep_batch', 'a member cannot ask the sweep');
select is(tests.outcome('select public.voice_sweep_done(''[]''::jsonb)'), '42501 permission denied for function voice_sweep_done', 'nor tell it what was removed');
reset role;
select tests.act_service();
select is((select count(*)::int from jsonb_array_elements(public.voice_sweep_batch(500, interval '6 hours', false)) e
            where e ->> 'bucket' = 'note-voice' and e ->> 'path' in (tests.path(:'m', :'room', :'c5'), :'n4path')), 2,
          'the sweep hands out the queued note objects, with their bucket');
reset role;
select is(tests.attempts('note-voice', tests.path(:'m', :'room', :'c5')), 1, 'and counts the try');
select tests.act_service();
select is((select count(*)::int from jsonb_array_elements(public.voice_sweep_batch(500, interval '6 hours', false)) e
            where e ->> 'path' in (tests.path(:'m', :'room', :'c5'), :'n4path')), 0, 'a path just tried waits before it is handed out again');
select is((select count(*)::int from unnest(public.buddy_voice_sweep_batch(500, interval '6 hours', false)) x where x in (tests.path(:'m', :'room', :'c5'), :'n4path')), 0,
          'the buddy half of the sweep never hands out a note-voice path');
select public.voice_sweep_done(jsonb_build_array(jsonb_build_object('bucket', 'note-voice', 'path', tests.path(:'m', :'room', :'c5'))));
reset role;
select is(tests.in_trash('note-voice', tests.path(:'m', :'room', :'c5')), false, 'voice_sweep_done forgets the removed path');
select is(tests.in_trash('note-voice', :'n4path'), true, 'and only that one');
select tests.act_service();
select public.buddy_voice_sweep_done(array[:'n4path']);
reset role;
select is(tests.in_trash('note-voice', :'n4path'), true, 'the buddy half''s done cannot forget a note-voice path');

-- orphans: older than the grace, queued on the hourly run; a young or attached one is left; the live note's object is attached
select tests.obj(tests.path(:'m', :'room', gen_random_uuid()), :'m', 'audio/mp4', 1000, interval '7 hours');
select tests.obj(tests.path(:'m', :'room', gen_random_uuid()), :'m', 'audio/mp4', 1000, interval '1 hour');
select tests.path(:'m', :'room', gen_random_uuid()) as old_orphan \gset
select tests.obj(:'old_orphan', :'m', 'audio/mp4', 1000, interval '8 hours');
select tests.age_obj(tests.path(:'m', :'room', :'c1'), interval '9 hours');
select tests.act_service();
select ok(exists (select 1 from jsonb_array_elements(public.voice_sweep_batch(500, interval '6 hours', true)) e where e ->> 'path' = :'old_orphan'),
          'the hourly run queues and hands out an upload no note points at that is older than the grace');
reset role;
select is(tests.in_trash('note-voice', tests.path(:'m', :'room', :'c1')), false, 'an object a live voice note points at is never swept, however old');
select is(tests.obj_there(tests.path(:'m', :'room', :'c1')), true, 'and is still there');

-- a queued path whose note came back, or whose object is gone, is forgotten
select tests.queue('note-voice', tests.path(:'m', :'room', :'c1'));
select tests.queue('note-voice', tests.path(:'m', :'room', gen_random_uuid()));
select tests.act_service();
select is((select count(*)::int from jsonb_array_elements(public.voice_sweep_batch(500, interval '6 hours', false)) e where e ->> 'path' = tests.path(:'m', :'room', :'c1')), 0,
          'a queued path a live note points at is not handed out');
reset role;
select is(tests.in_trash('note-voice', tests.path(:'m', :'room', :'c1')), false, 'and is forgotten');

-- ------------------------------------------------------------------ grants

select is(has_function_privilege('authenticated', 'public.post_note_voice(uuid, uuid, uuid, text, text, integer, smallint[], uuid)', 'execute'), true, 'authenticated: post_note_voice');
select is(has_function_privilege('anon', 'public.post_note_voice(uuid, uuid, uuid, text, text, integer, smallint[], uuid)', 'execute'), false, 'anon: no post_note_voice');
select is(has_function_privilege('authenticated', 'public.voice_sweep_batch(integer, interval, boolean)', 'execute'), false, 'authenticated: no voice_sweep_batch');
select is(has_function_privilege('authenticated', 'public.voice_sweep_done(jsonb)', 'execute'), false, 'authenticated: no voice_sweep_done');
select is(has_function_privilege('service_role', 'public.voice_sweep_batch(integer, interval, boolean)', 'execute'), true, 'service_role: voice_sweep_batch');
select is(has_function_privilege('service_role', 'public.voice_sweep_done(jsonb)', 'execute'), true, 'service_role: voice_sweep_done');
select is(has_function_privilege('authenticated', 'private.voice_sweep_pick(text[], integer, interval, boolean)', 'execute'), false, 'authenticated: no private.voice_sweep_pick');
select is(has_function_privilege('authenticated', 'private.note_voice_gone()', 'execute'), false, 'authenticated: no private.note_voice_gone');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'note_voice_%'), 2, 'two policies on the bucket: select and insert');
select is((select array_agg(cmd order by cmd) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'note_voice_%'), array['INSERT', 'SELECT'], 'and no update, no delete');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname in ('post_note_voice', 'note_voice_gone', 'note_voice_readable', 'note_voice_writable',
                  'note_voice_attached', 'voice_sweep_pick', 'voice_sweep_batch', 'voice_sweep_done', 'room_messages_check') and not p.prosecdef), 0,
          'every function of the voice notes that runs as the member or at commit is security definer');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname in ('post_note_voice', 'note_voice_gone', 'note_voice_readable', 'note_voice_writable',
                  'note_voice_attached', 'voice_sweep_pick', 'voice_sweep_batch', 'voice_sweep_done', 'room_messages_check', 'note_voice_path', 'note_voice_parts')
              and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))), 0,
          'and every one pins its search_path');

-- ------------------------------------------------------------------ account deletion queues the object

select tests.act_as(:'d');
select tests.say(:'room', :'ch1', gen_random_uuid()) as dj \gset
select tests.say(:'room', :'ch1', gen_random_uuid()) as dj2 \gset
select :'dj'::jsonb -> 'voice' ->> 'path' as dpath, :'dj2'::jsonb -> 'voice' ->> 'path' as dpath2 \gset
select is(tests.in_trash('note-voice', :'dpath'), false, 'before the deletion nothing is queued');
select public.delete_my_account();
reset role;
select is(tests.in_trash('note-voice', :'dpath'), true, 'deleting her account queued her first voice object');
select is(tests.in_trash('note-voice', :'dpath2'), true, 'and her second: the cascade fires the trigger for every row');
select is((select count(*)::int from public.room_messages where author_id = :'d'), 0, 'and her notes are gone');

select * from finish();
rollback;
