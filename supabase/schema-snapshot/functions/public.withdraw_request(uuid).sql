CREATE OR REPLACE FUNCTION public.withdraw_request(p_member uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  delete from public.follows
   where follower_id = v_caller and followee_id = p_member and accepted_at is null;
end;
$function$
;
