-- The member's own profile photo (issue #156). The first Storage bucket here.
--
-- What is stored: two squares the device cut, scaled and encoded itself
-- (web/app/data/avatar.ts), 512 px and 128 px, WebP (JPEG where the browser
-- cannot encode WebP), re-encoded through a canvas so no EXIF or GPS survives,
-- at most ~100 kB each:
--
--   avatars/<member id>/<hash>.webp       the photo
--   avatars/<member id>/<hash>-128.webp   the same, small (the tab header)
--
-- `<hash>` is the first 32 hex digits of the photo's SHA-256: a new photo is a
-- new path, so a device that kept the old one knows it has to fetch again,
-- and nothing has to be overwritten. `accounts.avatar_path` names the current
-- photo (the large one; the small one is the same path with `-128`), set and
-- cleared only through `set_avatar`, which checks both files are there.
--
-- Private bucket, no public URL. A photo is only ever shown to the member
-- herself (the header, the Profile), so nobody else has a reason to read it:
-- she downloads her own files with her session (the select policy below) and
-- the device keeps them (IndexedDB), so an offline start shows the photo too.
-- A public bucket would put a URL that works for anyone, signed in or not,
-- forever, into every cache and log it passes; a signed URL would expire under
-- the device's copy and buys nothing over an authenticated download. If photos
-- are ever shown to other members, a policy for them goes here.
--
-- Writing: a member inserts, replaces and deletes files only in her own folder
-- (the first folder of the path is her id), and only with the shape above.
-- Signed out: nothing at all (no policy for `anon`). The size limit and the
-- types are the Storage API's to enforce, before an object row is written.
--
-- Deleting the account: Storage objects may only be deleted through the
-- Storage API (`storage.protect_delete` refuses a direct delete from SQL, and a
-- deleted row would leave the file behind in the object store), so the client
-- removes her folder first (data/auth.ts, deleteAccount) and
-- `delete_my_account()` now refuses with `photo_remains` while any file of
-- hers is still in the bucket: no account goes and leaves her face behind.
--
-- Error codes (raised as the message, mapped by web/app/data/avatar.ts):
--   not_signed_in        no member
--   avatar_path_invalid  not `<her id>/<hash>.webp|jpg`
--   avatar_missing       a file of the pair is not in the bucket
--   photo_remains        (delete_my_account) her folder is not empty yet

-- ------------------------------------------------------------------ the bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 256 * 1024, array['image/webp', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The path a member may write: her own folder, a hex hash, the small one's
-- `-128`, one of the two types. Comparing the path rather than `owner_id` keeps
-- her out of anybody else's folder even with an object she owns. Spelled out in
-- each policy rather than in a helper: the schema `private` stays closed to the
-- API roles.

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{32}(-128)?\.(webp|jpg)$')
  );

-- Uploading the same photo again (upsert) replaces the file in place.
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (
    bucket_id = 'avatars'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{32}(-128)?\.(webp|jpg)$')
  );

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Her own files only: downloading them, listing her folder (to clear it), and
-- the upsert's own read of the row it replaces.
create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ------------------------------------------------------------- the account

alter table public.accounts
  add column avatar_path text,
  add column avatar_updated_at timestamptz;

comment on column public.accounts.avatar_path is
  'Her profile photo in the avatars bucket, <id>/<hash>.webp|jpg (the 128 px copy: <id>/<hash>-128.<ext>); null: initials. Set by set_avatar.';
comment on column public.accounts.avatar_updated_at is
  'When the photo was last set or removed.';

-- The member sets (a path) or removes (null) her photo. The files are uploaded
-- first; this only points the account at them, once both are there. Returns
-- the path it replaced, so the client can delete the old files.
create or replace function public.set_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_previous text;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if p_path is not null then
    if p_path !~ ('^' || v_member::text || '/[0-9a-f]{32}\.(webp|jpg)$') then
      raise exception 'avatar_path_invalid' using errcode = '22023';
    end if;
    if (select count(*) from storage.objects
         where bucket_id = 'avatars'
           and name in (p_path, regexp_replace(p_path, '\.(webp|jpg)$', '-128.\1'))) <> 2 then
      raise exception 'avatar_missing' using errcode = '22023';
    end if;
  end if;

  select avatar_path into v_previous from public.accounts where id = v_member for update;
  update public.accounts
     set avatar_path = p_path, avatar_updated_at = now()
   where id = v_member;
  return v_previous;
end;
$$;

comment on function public.set_avatar(text) is
  'Points the calling member''s account at her uploaded photo (<id>/<hash>.webp|jpg, both sizes in the avatars bucket), or at none (null). Returns the previous path.';

revoke all on function public.set_avatar(text) from public, anon;
grant execute on function public.set_avatar(text) to authenticated;

-- --------------------------------------------------------- deleting the account

-- As in 20261005101000_delete_my_account.sql, plus the photo: it has to be gone
-- through the Storage API first (see the top of this file).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if exists (select 1 from storage.objects
              where bucket_id = 'avatars' and (storage.foldername(name))[1] = v_member::text) then
    raise exception 'photo_remains' using errcode = '55000';
  end if;

  delete from public.library_entries where member_id = v_member;
  delete from auth.users where id = v_member;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the calling member completely: their auth user and, by cascade, everything they own. '
  'Refuses (photo_remains) while files of theirs are in the avatars bucket: those go through the Storage API first. '
  'Irreversible. Shared Catalogue books, the Goodreads cache and invite codes stay.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
