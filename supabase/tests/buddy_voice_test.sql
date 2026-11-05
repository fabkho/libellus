-- Buddy reads: voice messages (20261114020000_buddy_voice.sql):
--   supabase test db
--
-- A joined member uploads a recording under her own folder of the private bucket `buddy-voice` and posts it
-- with send_buddy_voice: in the room or a Section's thread, as an answer, with a Spoiler mark, idempotent on the
-- client id, under the limits of every message and a voice message's own. The row's checks say which columns a
-- voice message carries. Only a joined member of the read hears it (a non-member, a member blocked with the
-- author either way, a member who left and a signed-out caller get nothing), only the sender writes under her
-- folder, nobody deletes an object. A deleted message is a tombstone with no audio, and its object is queued
-- for the Edge Function's sweep: so is the object of a message a member deleted by leaving, of an account
-- deleted and of a read that went; an upload nobody sent is swept after a day, an attached object never. The
-- Realtime payload and the API row carry no signed URL, and the payload no object name. Assertions ask about
-- rows this test made, never counts of a table.

begin;
select plan(160);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-BUDDY-VOICE-1', 'buddy voice test', 40);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-BUDDY-VOICE-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.keys(p jsonb)
returns text[] language sql as $$ select array(select jsonb_object_keys(p) order by 1) $$;

create or replace function tests.outcome(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;

-- The name of an object: read / author / client id . extension.
create or replace function tests.path(p_read uuid, p_author uuid, p_client uuid, p_ext text default 'm4a')
returns text language sql as $$ select p_read || '/' || p_author || '/' || p_client || '.' || p_ext $$;

-- An object put in the bucket past RLS (what an upload leaves behind), at an age.
create or replace function tests.obj(p_name text, p_owner uuid, p_mime text default 'audio/mp4',
                                     p_size bigint default 12345, p_age interval default interval '0')
returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata, created_at)
  values ('buddy-voice', p_name, p_owner::text, jsonb_build_object('mimetype', p_mime, 'size', p_size), now() - p_age)
$$;

-- An upload as the acting member: the insert policy decides. Answers 'ok' or the sqlstate.
create or replace function tests.upload(p_name text, p_owner uuid, p_mime text default 'audio/mp4', p_size bigint default 12345)
returns text language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('buddy-voice', p_name, p_owner::text, jsonb_build_object('mimetype', p_mime, 'size', p_size));
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- How many of these objects the acting member may see: the select policy decides.
create or replace function tests.heard(p_name text)
returns integer language sql as $$
  select count(*)::integer from storage.objects where bucket_id = 'buddy-voice' and name = p_name
$$;

-- Past RLS.
create or replace function tests.obj_there(p_name text)
returns boolean language sql security definer as $$
  select exists (select 1 from storage.objects where bucket_id = 'buddy-voice' and name = p_name)
$$;
create or replace function tests.age_obj(p_name text, p_age interval)
returns void language sql security definer as $$
  update storage.objects set created_at = now() - p_age where bucket_id = 'buddy-voice' and name = p_name
$$;
create or replace function tests.obj_remove(p_name text)
returns void language sql security definer as $$
  delete from storage.objects where bucket_id = 'buddy-voice' and name = p_name
$$;
create or replace function tests.in_trash(p_name text)
returns boolean language sql security definer as $$
  select exists (select 1 from private.buddy_voice_trash where path = p_name)
$$;
create or replace function tests.msg(p_id uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(m) from public.buddy_messages m where m.id = p_id
$$;
create or replace function tests.msgs_in(p_read uuid)
returns integer language sql security definer as $$
  select count(*)::integer from public.buddy_messages where buddy_read_id = p_read
$$;
create or replace function tests.block(p_blocker uuid, p_blocked uuid)
returns void language sql security definer as $$
  insert into public.blocks (blocker_id, blocked_id) values (p_blocker, p_blocked) on conflict do nothing
$$;
create or replace function tests.section_ids(p_read uuid)
returns uuid[] language sql security definer as $$
  select array_agg(id order by position) from public.buddy_read_sections where buddy_read_id = p_read
$$;
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
create or replace function tests.fill_objects(p_owner uuid, p_read uuid, p_n integer)
returns void language sql security definer as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  select 'buddy-voice', p_read || '/' || p_owner || '/' || gen_random_uuid() || '.m4a', p_owner::text, '{"mimetype":"audio/mp4","size":1000}'::jsonb
    from generate_series(1, p_n)
$$;
create or replace function tests.clear_objects(p_owner uuid)
returns void language sql security definer as $$
  delete from storage.objects where bucket_id = 'buddy-voice' and owner_id = p_owner::text
$$;
-- A raw insert past the API: what the table's checks say (23514 or ok).
create or replace function tests.raw_insert(p_read uuid, p_author uuid, p_kind text, p_body text, p_mime text,
                                            p_duration integer, p_peaks smallint[], p_deleted boolean default false)
returns text language plpgsql security definer as $$
begin
  insert into public.buddy_messages (buddy_read_id, author_id, client_id, kind, body, voice_mime, voice_duration_ms, voice_peaks, deleted_at)
  values (p_read, p_author, gen_random_uuid(), p_kind, p_body, p_mime, p_duration, p_peaks, case when p_deleted then now() end);
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
create or replace function tests.last_report(p_member uuid)
returns jsonb language sql security definer as $$
  select to_jsonb(f) from public.feedback f where member_id = p_member and kind = 'report'
   order by created_at desc, id desc limit 1
$$;
create or replace function tests.name_owner(p_id uuid)
returns void language sql security definer as $$
  update private.instance_owner set owner_id = p_id
$$;
create or replace function tests.read_gone(p_read uuid)
returns boolean language sql security definer as $$
  select not exists (select 1 from public.buddy_reads where id = p_read)
$$;
-- The events a member's topic got (past RLS), by kind.
create or replace function tests.events(p_member uuid, p_event text)
returns setof jsonb language sql security definer as $$
  select payload from realtime.messages
   where topic = 'member:' || p_member and extension = 'broadcast' and event = p_event
$$;

-- A delete in SQL is refused by Storage's own guard unless asked for; the API deletes through it the same way.
-- Asked for here so the policies are what decide.
select set_config('storage.allow_delete_query', 'true', true);

grant usage on schema tests to anon, authenticated, service_role;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ------------------------------------------------------------------------- members and reads

select tests.member('hana@voice.pgtap.test', 'Hana') as hana \gset
select tests.member('ivo@voice.pgtap.test', 'Ivo') as ivo \gset
select tests.member('jo@voice.pgtap.test', 'Jo') as jo \gset
select tests.member('kim@voice.pgtap.test', 'Kim') as kim \gset
select tests.member('lu@voice.pgtap.test', 'Lu') as lu \gset
select tests.member('max@voice.pgtap.test', 'Max') as max \gset
select tests.member('ned@voice.pgtap.test', 'Ned') as ned \gset
select tests.member('ola@voice.pgtap.test', 'Ola') as ola \gset
select tests.member('sam@voice.pgtap.test', 'Sam') as sam \gset
select tests.member('rae@voice.pgtap.test', 'Rae') as rae \gset
select tests.member('owner@voice.pgtap.test', 'Owner') as owner \gset

-- Read A: Hana hosts, two parts and the end; Ivo, Jo, Lu, Max, Ned join by the link. Kim is in none.
select tests.act_as(:'hana');
select (public.add_to_library(tests.snap('Voice Dune'))).id as e_dune \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_dune'),
                                gen_random_uuid(), tests.secs(2), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_a, (:'v'::jsonb ->> 'link_token') as t_a \gset
-- Read B: Ola hosts, one part; Ivo joins (a second read of Ivo's, for a message sent into the wrong read).
select tests.act_as(:'ola');
select (public.add_to_library(tests.snap('Voice Other'))).id as e_other \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_other'),
                                gen_random_uuid(), tests.secs(1), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_b, (:'v'::jsonb ->> 'link_token') as t_b \gset
-- Read C: Sam hosts; Rae joins: both leave at the end and the read goes.
select tests.act_as(:'sam');
select (public.add_to_library(tests.snap('Voice Sam'))).id as e_sam \gset
select public.create_buddy_read((select book_id from public.library_entries where id = :'e_sam'),
                                gen_random_uuid(), tests.secs(1), p_link => true) as v \gset
select (:'v'::jsonb ->> 'id') as r_c, (:'v'::jsonb ->> 'link_token') as t_c \gset
reset role;

select tests.act_as(:'ivo');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'jo');   select public.join_buddy_read(:'t_a');
select tests.act_as(:'lu');   select public.join_buddy_read(:'t_a');
select tests.act_as(:'max');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ned');  select public.join_buddy_read(:'t_a');
select tests.act_as(:'ivo');  select public.join_buddy_read(:'t_b');
select tests.act_as(:'rae');  select public.join_buddy_read(:'t_c');
reset role;

select s[1] as a1, s[2] as a2, s[3] as a_end from (select tests.section_ids(:'r_a') s) x \gset
select s[1] as b1 from (select tests.section_ids(:'r_b') s) x \gset
select s[1] as cs1 from (select tests.section_ids(:'r_c') s) x \gset

select tests.name_owner(:'owner');

-- ------------------------------------------------------------------------- the bucket, grants

select is((select public from storage.buckets where id = 'buddy-voice'), false, 'the bucket is private: no public URL');
select is((select file_size_limit from storage.buckets where id = 'buddy-voice'), 3145728::bigint, 'it takes 3 MB an object');
select is((select allowed_mime_types from storage.buckets where id = 'buddy-voice'),
          array['audio/mp4', 'audio/webm', 'audio/ogg'], 'AAC in mp4, webm and ogg only');
select is((select array_agg(polname::text order by polname) from pg_policy
            where polrelid = 'storage.objects'::regclass and polname like 'buddy_voice%'),
          array['buddy_voice_insert_own', 'buddy_voice_select_members'],
          'the bucket has a select and an insert policy: no update, no delete');
select is((select array_agg(polcmd::text order by polname) from pg_policy
            where polrelid = 'storage.objects'::regclass and polname like 'buddy_voice%'),
          array['a', 'r'], 'the insert policy is for insert, the select policy for select');
select is(
  (select count(*)::int from unnest(array['public.send_buddy_voice(uuid, uuid, uuid, text, integer, integer[], uuid, boolean)']) f
    where has_function_privilege('anon', f::regprocedure, 'execute')
       or has_function_privilege('public', f::regprocedure, 'execute')
       or not has_function_privilege('authenticated', f::regprocedure, 'execute')
       or not (select prosecdef from pg_proc where oid = f::regprocedure)
       or (select proconfig from pg_proc where oid = f::regprocedure)
              is distinct from array['search_path=pg_catalog, public, private']),
  0, 'send_buddy_voice: members only, security definer, search path pinned');
select is(
  (select count(*)::int from unnest(array['public.buddy_voice_sweep_batch(integer, interval)', 'public.buddy_voice_sweep_done(text[])']) f,
          unnest(array['public', 'anon', 'authenticated']) r
    where has_function_privilege(r, f::regprocedure, 'execute')),
  0, 'the sweep functions are not for members or anon');
select is(
  (select count(*)::int from unnest(array['public.buddy_voice_sweep_batch(integer, interval)', 'public.buddy_voice_sweep_done(text[])']) f
    where not has_function_privilege('service_role', f::regprocedure, 'execute')),
  0, 'but the service role may call them');
select is(
  (select count(*)::int from unnest(array[
      'private.buddy_voice_ext(text)', 'private.buddy_voice_path(uuid, uuid, uuid, text)', 'private.buddy_voice_parts(text)',
      'private.buddy_voice_kick()', 'private.buddy_voice_gone()', 'private.buddy_voice_attached(text)',
      'private.buddy_voice_sweep_tick()'
    ]) f, unnest(array['public', 'anon', 'authenticated']) r
    where has_function_privilege(r, f::regprocedure, 'execute')),
  0, 'no API role can call a voice helper');
select is(
  (select count(*)::int from unnest(array['private.buddy_voice_readable(text)', 'private.buddy_voice_writable(text)']) f
    where has_function_privilege('anon', f::regprocedure, 'execute') or has_function_privilege('public', f::regprocedure, 'execute')
       or not has_function_privilege('authenticated', f::regprocedure, 'execute')),
  0, 'the two policy functions are executable by members (a policy runs as her) and by nobody else');
select is(
  (select count(*)::int from unnest(array['private.buddy_voice_trash', 'private.buddy_voice_settings']) t,
          unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete']) p
    where has_table_privilege(r, t, p)),
  0, 'the queue and its settings are granted to nobody');
select is((select relrowsecurity from pg_class where oid = 'private.buddy_voice_trash'::regclass), true, 'with RLS on');
select is((select function_url from private.buddy_voice_settings where id), null, 'the sweep is off until the owner gives it an address');
select is(private.buddy_voice_kick(), 'off', 'and a kick without an address sends nothing');

-- ------------------------------------------------------------------------- the row's checks (past the API)

select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 5000, array[10, 20]::smallint[]), 'ok', 'a voice row: type, length, waveform');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/webm', 120000, null), 'ok', 'two minutes, no waveform');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', null, 5000, null), '23514', 'a voice row needs a type');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mpeg', 5000, null), '23514', 'of the three');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', null, null), '23514', 'and a length');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 0, null), '23514', 'of at least 1 ms');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 120001, null), '23514', 'and at most two minutes');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', 'words', 'audio/mp4', 5000, null), '23514', 'it has no words');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 5000, array[101]::smallint[]), '23514', 'a waveform value is 0 - 100');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 5000, array[-1]::smallint[]), '23514', 'never below');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 5000, array_fill(1::smallint, array[49])), '23514', 'and at most 48 of them');
select is(tests.raw_insert(:'r_a', :'hana', 'text', 'hello', 'audio/mp4', 5000, null), '23514', 'a text carries no voice columns');
select is(tests.raw_insert(:'r_a', :'hana', 'text', '', null, null, null, true), 'ok', 'a tombstone is a text with nothing');
select is(tests.raw_insert(:'r_a', :'hana', 'voice', '', 'audio/mp4', 5000, null, true), '23514', 'and keeps no audio');
select is(tests.raw_insert(:'r_a', :'hana', 'sticker', '', null, null, null), '23514', 'no other kind is made');

-- ------------------------------------------------------------------------- uploading: the insert policy

select gen_random_uuid() as c1 \gset
select gen_random_uuid() as c2 \gset
select gen_random_uuid() as c3 \gset
select tests.path(:'r_a', :'hana', :'c1') as p1 \gset
select tests.path(:'r_a', :'hana', :'c2', 'webm') as p2 \gset
select tests.path(:'r_a', :'hana', :'c3') as p3 \gset

select tests.act_as(:'hana');
select is(tests.upload(:'p1', :'hana'), 'ok', 'a member uploads under her own folder of her read');
select is(tests.upload(:'p2', :'hana', 'audio/webm'), 'ok', 'a webm too');
select is(tests.upload(tests.path(:'r_a', :'ivo', gen_random_uuid()), :'hana'), '42501', 'not under another member''s folder');
select is(tests.upload(:'r_a' || '/' || :'hana' || '/' || gen_random_uuid() || '.mp3', :'hana'), '42501', 'only the three extensions');
select is(tests.upload(:'r_a' || '/' || :'hana' || '/not-a-uuid.m4a', :'hana'), '42501', 'only a client id as the name');
select is(tests.upload(:'hana' || '/' || gen_random_uuid() || '.m4a', :'hana'), '42501', 'only the three-part name');
select is(tests.upload(tests.path(:'r_b', :'hana', gen_random_uuid()), :'hana'), '42501', 'not into a read she is not in');
select tests.act_as(:'kim');
select is(tests.upload(tests.path(:'r_a', :'kim', gen_random_uuid()), :'kim'), '42501', 'a stranger to the read cannot upload into it');
select tests.act_anon();
select is(tests.upload(tests.path(:'r_a', :'hana', gen_random_uuid()), :'hana'), '42501', 'signed out: nothing');
reset role;

-- A member cannot delete or replace an object.
select tests.act_as(:'hana');
select is(tests.outcome(format($$ delete from storage.objects where bucket_id = 'buddy-voice' and name = '%s' $$, :'p1')), 'ok',
          'a delete as a member runs');
select is(tests.obj_there(:'p1'), true, 'and removes nothing: there is no delete policy');
select is(tests.outcome(format($$ update storage.objects set name = name || 'x' where bucket_id = 'buddy-voice' and name = '%s' $$, :'p1')), 'ok',
          'an update as a member runs');
select is(tests.obj_there(:'p1'), true, 'and changes nothing: there is no update policy');
reset role;

-- The 60 an hour.
select tests.fill_objects(:'ned', :'r_a', 60);
select tests.act_as(:'ned');
select is(tests.upload(tests.path(:'r_a', :'ned', gen_random_uuid()), :'ned'), '42501', 'sixty objects within the hour are the most she uploads');
reset role;
select tests.clear_objects(:'ned');
select tests.act_as(:'ned');
select is(tests.upload(tests.path(:'r_a', :'ned', gen_random_uuid()), :'ned'), 'ok', 'and her hour is her own');
reset role;
select tests.clear_objects(:'ned');

-- ------------------------------------------------------------------------- sending

select tests.act_as(:'hana');
select public.send_buddy_voice(:'r_a', :'a1', :'c1', 'audio/mp4', 5400, array[10, 40, 100, 0]) as sent \gset
select is(:'sent'::jsonb ->> 'kind', 'voice', 'a voice message: kind voice');
select is(:'sent'::jsonb #>> '{voice,mime}', 'audio/mp4', 'its type');
select is((:'sent'::jsonb #>> '{voice,duration_ms}')::int, 5400, 'its length');
select is(:'sent'::jsonb #> '{voice,peaks}', '[10, 40, 100, 0]'::jsonb, 'its waveform');
select is(:'sent'::jsonb #>> '{voice,path}', :'p1', 'and where its object is');
select is(:'sent'::jsonb ->> 'body', '', 'it has no words');
select is(:'sent'::jsonb ->> 'section_id', :'a1', 'in the Section''s thread');
select is(:'sent'::jsonb ->> 'client_id', :'c1', 'under her client id');
select is(tests.keys(:'sent'::jsonb),
          array['author', 'body', 'client_id', 'created_at', 'deleted_at', 'id', 'kind', 'media_height', 'media_url',
                'media_width', 'reactions', 'reply_to', 'section_id', 'spoiler', 'voice'],
          'the row has a text message''s keys and `voice`');
select ok(:'sent'::text !~* 'https?://|token|signed', 'it holds no URL and no signature');
select is(public.send_buddy_voice(:'r_a', :'a1', :'c1', 'audio/mp4', 5400, array[10, 40, 100, 0]) ->> 'id', :'sent'::jsonb ->> 'id',
          'the same client id again answers the message it made');
select is(public.send_buddy_voice(:'r_a', :'a1', :'c1', 'audio/mp4', 1000, null) ->> 'id', :'sent'::jsonb ->> 'id',
          'whatever the retry says about the length');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', '%s', '%s', 'audio/mp4', 5400) $$, :'r_a', :'a2', :'c1')),
          'PT409 message_client_id_reused', 'another thread is a reused client id');
select is(tests.outcome(format($$ select public.post_buddy_message('%s', '%s', '%s', 'text', 'hello') $$, :'r_a', :'a1', :'c1')),
          'PT409 message_client_id_reused', 'and so is a text with it');
select is(tests.outcome(format($$ select public.post_buddy_message('%s', '%s', gen_random_uuid(), 'voice', '') $$, :'r_a', :'a1')),
          '22023 message_kind_invalid', 'post_buddy_message does not make a voice message: only send_buddy_voice does');
select is(tests.msgs_in(:'r_a') - 3, 1, 'one message was made, past the three raw rows');
select (:'sent'::jsonb ->> 'id')::uuid as m1 \gset

-- The room, an answer, a Spoiler.
select tests.obj(tests.path(:'r_a', :'hana', :'c3'), :'hana');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000, null, '%s') $$, :'r_a', :'c3', :'m1')),
          '22023 message_reply_unavailable', 'an answer stays in its thread (the room is not the Section)');
select is(public.send_buddy_voice(:'r_a', null, :'c3', 'audio/mp4', 2000) ->> 'section_id', null, 'the room''s voice message has no Section');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000, null, null, true) $$,
                               :'r_a', gen_random_uuid())), '22023 message_spoiler_unavailable', 'a Spoiler only in a Section');

select gen_random_uuid() as c4 \gset
select tests.obj(tests.path(:'r_a', :'hana', :'c4'), :'hana');
select is(public.send_buddy_voice(:'r_a', :'a1', :'c4', 'audio/mp4', 2000, null, :'m1'::uuid, true) ->> 'spoiler', 'true', 'a Section''s voice message may be a Spoiler');
select is(public.send_buddy_voice(:'r_a', :'a1', :'c4', 'audio/mp4', 2000) ->> 'reply_to', :'m1', 'and answers a message of its thread');

-- ------------------------------------------------------------------------- refusals

select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, null, 'audio/mp4', 2000) $$, :'r_a')),
          '22023 message_client_id_required', 'a client id is needed');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mpeg', 2000) $$, :'r_a', gen_random_uuid())),
          '22023 message_voice_invalid', 'a type of the three');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 0) $$, :'r_a', gen_random_uuid())),
          '22023 message_voice_invalid', 'a length of 1 ms or more');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 120001) $$, :'r_a', gen_random_uuid())),
          '22023 message_voice_invalid', 'two minutes at most');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000, array[101]) $$, :'r_a', gen_random_uuid())),
          '22023 message_voice_invalid', 'a waveform of 0 - 100');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', gen_random_uuid())),
          '22023 message_voice_missing', 'an object that was never uploaded');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', '%s', '%s', 'audio/mp4', 2000) $$, :'r_a', :'b1', gen_random_uuid())),
          '22023 buddy_section_invalid', 'a Section of another read');

select gen_random_uuid() as c5 \gset
select tests.obj(tests.path(:'r_a', :'hana', :'c5'), :'hana', 'audio/webm');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c5')),
          '22023 message_voice_invalid', 'an m4a name holding another type is refused');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/webm', 2000) $$, :'r_a', :'c5')),
          '22023 message_voice_missing', 'a webm message needs a .webm object: the name says the type');
select gen_random_uuid() as c9 \gset
select tests.obj(tests.path(:'r_a', :'hana', :'c9'), :'hana', 'audio/mp4', 3145729);
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c9')),
          '22023 message_voice_too_large', 'over 3 MB is too large');
select gen_random_uuid() as c10 \gset
select tests.obj(tests.path(:'r_a', :'hana', :'c10'), :'hana', 'audio/mp4', 0);
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c10')),
          '22023 message_voice_invalid', 'an empty file is no message');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_b', gen_random_uuid())),
          'PT404 not_found', 'a read she is not in');
select tests.act_as(:'kim');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', gen_random_uuid())),
          'PT404 not_found', 'a stranger gets not_found');
select tests.act_anon();
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', gen_random_uuid())),
          '42501 permission denied for function send_buddy_voice', 'signed out: no permission');
reset role;

-- ------------------------------------------------------------------------- the limits

select gen_random_uuid() as c11 \gset
select tests.clear_calls(:'hana');
select tests.obj(tests.path(:'r_a', :'hana', :'c11'), :'hana');
select tests.fill_messages(:'r_a', :'hana', 30, now());
select tests.act_as(:'hana');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c11')),
          'PT429 message_rate_limited', 'a voice message counts among the 30 a minute');
reset role;
delete from public.buddy_messages where body like 'filler %' and author_id = :'hana'::uuid;
select tests.fill_calls(:'hana', 'voice', 10);
select tests.act_as(:'hana');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c11')),
          'PT429 rate_limited', 'and a voice message''s own 10 a minute');
reset role;
select tests.clear_calls(:'hana');
select tests.fill_calls(:'hana', 'voice_day', 100);
select tests.act_as(:'hana');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', :'c11')),
          'PT429 rate_limited', 'and 100 a day');
reset role;
select tests.clear_calls(:'hana');
select tests.act_as(:'hana');
select is(public.send_buddy_voice(:'r_a', null, :'c11', 'audio/mp4', 2000) ->> 'kind', 'voice', 'under the limits it goes through');
reset role;

-- ------------------------------------------------------------------------- who hears

select tests.act_as(:'ivo');
select is(tests.heard(:'p1'), 1, 'a member of the read hears it');
select is((select m #>> '{voice,path}' from jsonb_array_elements(public.buddy_read_messages(:'r_a', :'a1')) m where m ->> 'id' = :'m1'), :'p1',
          'and her page of the thread names its object');
select tests.act_as(:'hana');
select is(tests.heard(:'p1'), 1, 'its author too');
select tests.act_as(:'kim');
select is(tests.heard(:'p1'), 0, 'a stranger to the read hears nothing');
select tests.act_anon();
select is(tests.heard(:'p1'), 0, 'signed out: nothing');
select tests.act_as(:'ola');
select is(tests.heard(:'p1'), 0, 'a member of another read hears nothing');
select tests.act_as(:'hana');
select is(tests.heard(tests.path(:'r_a', :'hana', :'c5')), 0, 'an object no message points at is heard by nobody, its uploader included');
reset role;

-- A block between the author and a member: neither hears the other's voice, both ways.
select gen_random_uuid() as cj \gset
select gen_random_uuid() as ci \gset
select tests.obj(tests.path(:'r_a', :'jo', :'cj'), :'jo');
select tests.obj(tests.path(:'r_a', :'ivo', :'ci'), :'ivo');
select tests.act_as(:'jo');  select public.send_buddy_voice(:'r_a', :'a1', :'cj', 'audio/mp4', 3000) ->> 'id' as mj \gset
select tests.act_as(:'ivo');
select is(tests.heard(tests.path(:'r_a', :'jo', :'cj')), 1, 'before the block Ivo hears Jo');
select tests.block(:'ivo', :'jo');
select is(tests.heard(tests.path(:'r_a', :'jo', :'cj')), 0, 'after it Ivo does not hear Jo');
select public.send_buddy_voice(:'r_a', :'a1', :'ci', 'audio/mp4', 3000) ->> 'id' as mi \gset
select is(tests.heard(tests.path(:'r_a', :'ivo', :'ci')), 1, 'and hears his own');
select tests.act_as(:'jo');
select is(tests.heard(tests.path(:'r_a', :'ivo', :'ci')), 0, 'Jo does not hear Ivo either');
select is(tests.heard(tests.path(:'r_a', :'jo', :'cj')), 1, 'and hears her own');
select is((select count(*)::int from jsonb_array_elements(public.buddy_read_messages(:'r_a', :'a1')) m where m ->> 'id' = :'mi'), 0,
          'her page of the thread does not list his message');
select tests.act_as(:'hana');
select is(tests.heard(tests.path(:'r_a', :'jo', :'cj')), 1, 'the host hears them both, as she reads their messages');
reset role;

-- ------------------------------------------------------------------------- the Realtime payload

select is((select count(*)::int from tests.events(:'ivo', 'message.new') e where e ->> 'id' = :'m1'), 1, 'Ivo got the message live');
select is(tests.keys((select e from tests.events(:'ivo', 'message.new') e where e ->> 'id' = :'m1')),
          array['author_id', 'body', 'buddy_read_id', 'client_id', 'created_at', 'id', 'kind', 'media_height', 'media_url',
                'media_width', 'reply_to', 'section_id', 'spoiler', 'voice'],
          'its payload is a text message''s and `voice`');
select is(tests.keys((select e -> 'voice' from tests.events(:'ivo', 'message.new') e where e ->> 'id' = :'m1')),
          array['duration_ms', 'mime', 'peaks'], 'which has the type, the length and the waveform');
select ok((select e::text !~ 'http|token|sign|\.m4a|buddy-voice' from tests.events(:'ivo', 'message.new') e where e ->> 'id' = :'m1'),
          'and no object name, no URL, no signature');
select is((select count(*)::int from tests.events(:'kim', 'message.new') e where e ->> 'id' = :'m1'), 0, 'a stranger got nothing');
select is((select count(*)::int from tests.events(:'jo', 'message.new') e where e ->> 'id' = :'mi'), 0, 'nor did a member blocked with the author');

-- ------------------------------------------------------------------------- a report

select tests.act_as(:'ivo');
select lives_ok(format($$ select public.report_buddy_message('%s', 'spam', null) $$, :'m1'), 'a voice message is reported');
reset role;
select is(tests.last_report(:'ivo') #>> '{context,kind}', 'voice', 'the report says its kind');
select is(tests.last_report(:'ivo') #>> '{context,excerpt}', 'Voice message, 5 s', 'and its excerpt what it is and how long');
select ok(tests.last_report(:'ivo')::text !~ 'buddy-voice|\.m4a|http', 'with no object name');

-- ------------------------------------------------------------------------- deleting: a tombstone, no audio

select tests.act_as(:'hana');
select is(tests.heard(:'p1'), 1, 'before it is deleted its object is heard');
select is(tests.in_trash(:'p1'), false, 'and not queued');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'m1'), 'the author deletes her voice message');
select is(tests.in_trash(:'p1'), true, 'its object is queued for the sweep');
select is(tests.obj_there(:'p1'), true, 'it is still in the bucket until the sweep has run');
select is(tests.heard(:'p1'), 0, 'but nobody hears it any more, not even its author');
select tests.act_as(:'ivo');
select is(tests.heard(:'p1'), 0, 'nor the members');
select is((select m ->> 'kind' from jsonb_array_elements(public.buddy_read_messages(:'r_a', :'a1')) m where m ->> 'id' = :'m1'), 'text',
          'the tombstone reads as a text');
select is((select m::jsonb ? 'voice' from jsonb_array_elements(public.buddy_read_messages(:'r_a', :'a1')) m where m ->> 'id' = :'m1'), false,
          'with no voice key');
select is((select m ->> 'body' from jsonb_array_elements(public.buddy_read_messages(:'r_a', :'a1')) m where m ->> 'id' = :'m1'), null,
          'no words');
reset role;
select is(tests.msg(:'m1'::uuid) ->> 'voice_mime', null, 'no type kept in the table');
select is(tests.msg(:'m1'::uuid) ->> 'voice_duration_ms', null, 'no length');
select is(tests.msg(:'m1'::uuid) -> 'voice_peaks', 'null'::jsonb, 'no waveform');
select gen_random_uuid() as cz \gset
select tests.obj(tests.path(:'r_a', :'ivo', :'cz'), :'ivo');
select tests.act_as(:'ivo');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', '%s', '%s', 'audio/mp4', 2000, null, '%s') $$, :'r_a', :'a1', :'cz', :'m1')),
          '22023 message_reply_unavailable', 'nobody answers a tombstone');
reset role;
select tests.act_as(:'hana');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'m1'), 'deleting again changes nothing');
reset role;
select is((select count(*)::int from private.buddy_voice_trash where path = :'p1'), 1, 'and queues nothing twice');

-- The host deletes another member's voice message.
select tests.act_as(:'hana');
select lives_ok(format($$ select public.delete_buddy_message('%s') $$, :'mi'), 'the host deletes a member''s voice message (also one she is blocked with)');
select is(tests.in_trash(tests.path(:'r_a', :'ivo', :'ci')), true, 'its object is queued too');
select tests.act_as(:'ivo');
select is(tests.outcome(format($$ select public.delete_buddy_message('%s') $$, :'mj')), 'PT404 not_found', 'a member does not delete another''s (not found across the block)');
reset role;

-- ------------------------------------------------------------------------- the sweep

-- An object queued and gone from the bucket is forgotten; a queued one there is listed.
select tests.act_service();
select is(public.buddy_voice_sweep_batch(100) @> array[:'p1'], true, 'the batch lists the deleted message''s object');
select is(public.buddy_voice_sweep_batch(100) @> array[tests.path(:'r_a', :'jo', :'cj')], false, 'never an object a live message points at');
reset role;
select tests.obj_remove(:'p1');
select tests.act_service();
select is(public.buddy_voice_sweep_batch(100) @> array[:'p1'], false, 'an object the bucket no longer has is not listed');
reset role;
select is(tests.in_trash(:'p1'), false, 'and is forgotten by the queue');
select tests.act_service();
select is(public.buddy_voice_sweep_batch(100) @> array[tests.path(:'r_a', :'ivo', :'ci')], true, 'the host''s deletion is listed');
select public.buddy_voice_sweep_done(array[tests.path(:'r_a', :'ivo', :'ci'), 'nothing']);
reset role;
select is(tests.in_trash(tests.path(:'r_a', :'ivo', :'ci')), false, 'done forgets what the function removed');

-- An upload no message points at: swept after a day, never before; one a live message points at, never.
select gen_random_uuid() as cu1 \gset
select gen_random_uuid() as cu2 \gset
select tests.obj(tests.path(:'r_a', :'hana', :'cu1'), :'hana', 'audio/mp4', 1000, interval '2 days');
select tests.obj(tests.path(:'r_a', :'hana', :'cu2'), :'hana', 'audio/mp4', 1000, interval '1 hour');
select tests.path(:'r_a', :'hana', gen_random_uuid(), 'wav') as pw \gset
select tests.obj(:'pw', :'hana', 'audio/mp4', 1000, interval '2 days');
select tests.age_obj(tests.path(:'r_a', :'jo', :'cj'), interval '3 days');
select tests.act_service();
select is(public.buddy_voice_sweep_batch(1000) @> array[tests.path(:'r_a', :'hana', :'cu1')], true, 'an upload of two days ago that never became a message is listed');
select is(public.buddy_voice_sweep_batch(1000) @> array[tests.path(:'r_a', :'hana', :'cu2')], false, 'one of an hour ago is not (its message is on its way)');
select is(public.buddy_voice_sweep_batch(1000) @> array[tests.path(:'r_a', :'jo', :'cj')], false, 'a live message''s object is not, however old');
select is(public.buddy_voice_sweep_batch(1000) @> array[:'pw'], true, 'an object with a name that is no message''s is junk and listed');
select is(public.buddy_voice_sweep_batch(1000, interval '0 seconds') @> array[tests.path(:'r_a', :'hana', :'cu2')], true, 'the grace is the caller''s to shorten');
select is(public.buddy_voice_sweep_batch(1) is not null and cardinality(public.buddy_voice_sweep_batch(1)) = 1, true, 'the limit is honoured');
reset role;
select tests.act_as(:'hana');
select is(tests.outcome($$ select public.buddy_voice_sweep_batch(10) $$), '42501 permission denied for function buddy_voice_sweep_batch', 'a member cannot call the sweep');
reset role;

-- ------------------------------------------------------------------------- leaving, with and without her messages

select gen_random_uuid() as cl \gset
select gen_random_uuid() as cm \gset
select gen_random_uuid() as cn \gset
select tests.obj(tests.path(:'r_a', :'lu', :'cl'), :'lu');
select tests.obj(tests.path(:'r_a', :'max', :'cm'), :'max');
select tests.obj(tests.path(:'r_a', :'ned', :'cn'), :'ned');
select tests.act_as(:'lu');  select public.send_buddy_voice(:'r_a', :'a2', :'cl', 'audio/mp4', 3000) ->> 'id' as ml \gset
select tests.act_as(:'max'); select public.send_buddy_voice(:'r_a', :'a2', :'cm', 'audio/mp4', 3000) ->> 'id' as mm \gset
select tests.act_as(:'ned'); select public.send_buddy_voice(:'r_a', :'a2', :'cn', 'audio/mp4', 3000) ->> 'id' as mn \gset
select tests.act_as(:'ivo');
select is(tests.heard(tests.path(:'r_a', :'lu', :'cl')), 1, 'Ivo hears Lu while she is in');

select tests.act_as(:'lu');
select is(tests.heard(tests.path(:'r_a', :'lu', :'cl')), 1, 'and Lu her own');
select lives_ok(format($$ select public.leave_buddy_read('%s') $$, :'r_a'), 'Lu leaves, keeping her messages');
select is(tests.heard(tests.path(:'r_a', :'lu', :'cl')), 0, 'a member who left hears nothing of the read, not even her own');
select tests.act_as(:'ivo');
select is(tests.heard(tests.path(:'r_a', :'lu', :'cl')), 1, 'her message stays for the members, and so does its audio');
reset role;
select is(tests.in_trash(tests.path(:'r_a', :'lu', :'cl')), false, 'nothing is queued: it was not deleted');
select is(tests.obj_there(tests.path(:'r_a', :'lu', :'cl')), true, 'and the object is there');
select tests.act_as(:'lu');
select is(tests.upload(tests.path(:'r_a', :'lu', gen_random_uuid()), :'lu'), '42501', 'she cannot upload into it again');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_a', gen_random_uuid())), 'PT404 not_found', 'nor send');
select is(public.send_buddy_voice(:'r_a', :'a2', :'cl', 'audio/mp4', 3000) ->> 'id', :'ml', 'but a retry of what she sent answers the same message') ;
reset role;

select tests.act_as(:'max');
select lives_ok(format($$ select public.leave_buddy_read('%s', true) $$, :'r_a'), 'Max leaves with his messages');
reset role;
select is(tests.msg(:'mm'::uuid), null, 'his message is gone');
select is(tests.in_trash(tests.path(:'r_a', :'max', :'cm')), true, 'and its object is queued');
select tests.act_as(:'ivo');
select is(tests.heard(tests.path(:'r_a', :'max', :'cm')), 0, 'nobody hears it in the meantime');
reset role;

select tests.act_as(:'ned');
select lives_ok($$ select public.delete_my_account() $$, 'Ned deletes his account');
reset role;
select is(tests.msg(:'mn'::uuid), null, 'his message goes with it');
select is(tests.in_trash(tests.path(:'r_a', :'ned', :'cn')), true, 'and its object is queued');

-- A read that goes: its voice messages' objects are queued.
select gen_random_uuid() as cr \gset
select tests.obj(tests.path(:'r_c', :'rae', :'cr'), :'rae');
select tests.act_as(:'rae'); select public.send_buddy_voice(:'r_c', :'cs1', :'cr', 'audio/mp4', 3000) ->> 'id' as mr \gset
select public.leave_buddy_read(:'r_c');
select tests.act_as(:'sam'); select public.leave_buddy_read(:'r_c');
reset role;
select is(tests.read_gone(:'r_c'), true, 'the last member out ends the read');
select is(tests.in_trash(tests.path(:'r_c', :'rae', :'cr')), true, 'and the objects of its messages are queued');

-- ------------------------------------------------------------------------- archived

select tests.act_as(:'ola');
select public.archive_buddy_read(:'r_b');
select gen_random_uuid() as ca \gset
select tests.act_as(:'ivo');
select is(tests.upload(tests.path(:'r_b', :'ivo', :'ca'), :'ivo'), '42501', 'nothing is uploaded into an archived read');
reset role;
select tests.obj(tests.path(:'r_b', :'ivo', :'ca'), :'ivo');
select tests.act_as(:'ivo');
select is(tests.outcome(format($$ select public.send_buddy_voice('%s', null, '%s', 'audio/mp4', 2000) $$, :'r_b', :'ca')), 'PT409 buddy_read_archived', 'nor sent into it');
reset role;

select * from finish();
rollback;
