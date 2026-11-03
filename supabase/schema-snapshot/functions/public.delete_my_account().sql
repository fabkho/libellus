CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_read   uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if exists (select 1 from storage.objects
              where bucket_id = 'avatars' and (storage.foldername(name))[1] = v_member::text) then
    raise exception 'photo_remains' using errcode = '55000';
  end if;

  -- Buddy reads: the lock of every read she is in, in one order, before any row of hers is deleted, so
  -- the host handover of private.buddy_member_gone never waits behind a lock this deletion holds.
  for v_read in select buddy_read_id from public.buddy_read_members where member_id = v_member order by buddy_read_id loop
    perform private.buddy_lock_read(v_read);
  end loop;

  delete from public.library_entries where member_id = v_member;
  delete from auth.users where id = v_member;
end;
$function$
;
