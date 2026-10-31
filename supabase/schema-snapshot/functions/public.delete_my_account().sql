CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
