CREATE OR REPLACE FUNCTION public.set_avatar(p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
$function$
;
