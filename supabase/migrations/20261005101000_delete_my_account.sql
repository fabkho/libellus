-- Delete your account from inside the app (issue #101).
--
-- Google Play requires an in-app way to delete an account. The client cannot
-- delete an auth user with the anon key, so the member calls this function, which
-- deletes their own `auth.users` row and nothing else. Everything the member owns
-- goes with it by the foreign keys that already cascade from `auth.users`:
--   accounts, library_entries (-> reading_sessions -> reading_progress_days,
--   collection_entries), collections, manual books (`books.owner_id`),
--   synced_writes; and Supabase's own sessions, identities and refresh tokens.
-- What stays: the shared Catalogue books, the Goodreads cache, and the invite
-- codes (the use count of the code the member came in on is not given back).
--
-- The library entries are deleted first, explicitly: `library_entries.book_id`
-- is `on delete restrict` (a Catalogue book must never vanish under a Library),
-- and a manual book is deleted by the same cascade that deletes the entries
-- pointing at it, in no guaranteed order.

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

  delete from public.library_entries where member_id = v_member;
  delete from auth.users where id = v_member;
end;
$$;

comment on function public.delete_my_account() is
  'Deletes the calling member completely: their auth user and, by cascade, everything they own. '
  'Irreversible. Shared Catalogue books, the Goodreads cache and invite codes stay.';

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
