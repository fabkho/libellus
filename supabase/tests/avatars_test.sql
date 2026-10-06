-- The member's profile photo (issue #156):
--   supabase test db
--
-- The `avatars` bucket is private and its policies keep every file to the
-- member whose folder it is in: she uploads (only with the agreed path shape),
-- replaces, reads, lists and deletes her own; another member can do none of
-- that to hers, not even see that they exist; a signed-out caller can do
-- nothing at all. `set_avatar` points her account at an uploaded pair or at
-- none and checks the path and the files; `delete_my_account` refuses while a
-- file of hers is left. The Storage API runs the same queries under the
-- caller's role, so these are the rules the app meets. Assertions act as the
-- member and look only at the rows this test made.

begin;
select plan(34);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-AVATAR', 'avatar test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-AVATAR"}'::jsonb, now(), now(), now());
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

-- Her files, past RLS.
create or replace function tests.files_of(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from storage.objects
   where bucket_id = 'avatars' and (storage.foldername(name))[1] = p_member::text
$$;

create or replace function tests.has_account(p_member uuid)
returns boolean language sql security definer as $$
  select exists (select 1 from public.accounts where id = p_member)
$$;

select tests.member('ida@avatar.test') as ida \gset
select tests.member('bea@avatar.test') as bea \gset
select :'ida' || '/' || repeat('a1', 16) as ida_photo \gset
select :'ida' || '/' || repeat('a1', 16) || '-128' as ida_small_stem \gset
select :'ida' || '/' || repeat('b2', 16) as ida_next \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- A delete in SQL is refused by Storage's own guard unless asked for; the API
-- deletes through it the same way. Asked for here so the policies are what decide.
select set_config('storage.allow_delete_query', 'true', true);

-- ------------------------------------------------------------------ the bucket

select is((select public from storage.buckets where id = 'avatars'), false, 'the avatars bucket is private: no public URL');
select is((select file_size_limit from storage.buckets where id = 'avatars'), 262144::bigint, 'it takes files up to 256 kB');
select is((select allowed_mime_types from storage.buckets where id = 'avatars'), array['image/webp', 'image/jpeg'], 'WebP and JPEG only');

-- ------------------------------------------------------------ Ida uploads

select tests.act_as(:'ida');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s.webp', '%s'), ('avatars', '%s.webp', '%s') $$,
         :'ida_photo', :'ida', :'ida_small_stem', :'ida'),
  'Ida uploads her photo and its small copy into her folder');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s/me.png', '%s') $$, :'ida', :'ida'),
  '42501', null, 'any other name in her folder is refused');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s/%s.webp', '%s') $$, :'bea', repeat('c3', 16), :'ida'),
  '42501', null, 'a file in Bea''s folder is refused');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name, owner_id) values ('avatars', '%s.webp', '%s') $$, repeat('c3', 16), :'ida'),
  '42501', null, 'and one outside any folder');
select isnt_empty(
  format($$ select name from storage.objects where bucket_id = 'avatars' and name = '%s.webp' $$, :'ida_photo'),
  'Ida reads her own file');
select isnt_empty(
  format($$ update storage.objects set metadata = '{"size":1}' where bucket_id = 'avatars' and name = '%s.webp' returning name $$, :'ida_photo'),
  'and replaces it');
reset role;

-- ------------------------------------------------------------ Bea cannot

select tests.act_as(:'bea');
select is_empty(
  format($$ select name from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = '%s' $$, :'ida'),
  'Bea neither reads nor lists Ida''s files');
select is_empty(
  format($$ update storage.objects set name = '%s/%s.webp' where bucket_id = 'avatars' and name = '%s.webp' returning name $$, :'bea', repeat('c3', 16), :'ida_photo'),
  'nor moves one into her own folder');
select is_empty(
  format($$ update storage.objects set metadata = '{}' where bucket_id = 'avatars' and name = '%s.webp' returning name $$, :'ida_photo'),
  'nor overwrites one');
select is_empty(
  format($$ delete from storage.objects where bucket_id = 'avatars' and name = '%s.webp' returning name $$, :'ida_photo'),
  'nor deletes one');
select throws_ok(
  format($$ select public.set_avatar('%s.webp') $$, :'ida_photo'),
  '22023', 'avatar_path_invalid', 'nor points her own account at Ida''s photo');
select is_empty(
  format($$ select avatar_path from public.accounts where id = '%s' $$, :'ida'),
  'nor reads Ida''s account');
reset role;
select is(tests.files_of(:'ida'), 2::bigint, 'Ida''s two files are where they were');

-- ------------------------------------------------------------ signed out

set local role anon;
select is_empty(
  format($$ select name from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = '%s' $$, :'ida'),
  'a signed-out caller reads nothing');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('avatars', '%s/%s.webp') $$, :'ida', repeat('d4', 16)),
  '42501', null, 'and writes nothing');
select is_empty(
  format($$ delete from storage.objects where bucket_id = 'avatars' and name = '%s.webp' returning name $$, :'ida_photo'),
  'and deletes nothing');
select throws_ok($$ select public.set_avatar(null) $$, '42501', null, 'and cannot call set_avatar');
reset role;

-- ------------------------------------------------------------ set_avatar

select tests.act_as(:'ida');
select throws_ok(format($$ select public.set_avatar('%s.webp') $$, :'ida_next'), '22023', 'avatar_missing',
  'a photo that was not uploaded is refused');
select throws_ok(format($$ select public.set_avatar('%s-128.webp') $$, :'ida_photo'), '22023', 'avatar_path_invalid',
  'the small copy is not the photo''s path');
select throws_ok(format($$ select public.set_avatar('%s.png') $$, :'ida_photo'), '22023', 'avatar_path_invalid',
  'nor is another type');
select is(public.set_avatar(:'ida_photo' || '.webp'), null, 'Ida sets her photo; she had none before');
select is((select avatar_path from public.accounts where id = :'ida'::uuid), :'ida_photo' || '.webp', 'her account names it');
select ok((select avatar_updated_at from public.accounts where id = :'ida'::uuid) is not null, 'with when it was set');

insert into storage.objects (bucket_id, name, owner_id)
values ('avatars', :'ida_next' || '.jpg', :'ida'), ('avatars', :'ida_next' || '-128.jpg', :'ida');
select is(public.set_avatar(:'ida_next' || '.jpg'), :'ida_photo' || '.webp', 'replacing it answers the path it replaced');
select is(public.set_avatar(null), :'ida_next' || '.jpg', 'removing it too');
select is((select avatar_path from public.accounts where id = :'ida'::uuid), null, 'and her account has none: initials');
reset role;

select tests.act_as(null);
select throws_ok($$ select public.set_avatar(null) $$, '42501', 'not_signed_in', 'a caller with no member is refused');
reset role;

-- ------------------------------------------------------------ deleting the account

select tests.act_as(:'ida');
select throws_ok($$ select public.delete_my_account() $$, '55000', 'photo_remains',
  'Ida cannot delete her account while her files are in the bucket');
select isnt_empty(
  format($$ delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = '%s' returning name $$, :'ida'),
  'she deletes her own files');
select lives_ok($$ select public.delete_my_account() $$, 'then her account goes');
reset role;
select is(tests.has_account(:'ida'), false, 'and her account row with it');

select * from finish();
rollback;
