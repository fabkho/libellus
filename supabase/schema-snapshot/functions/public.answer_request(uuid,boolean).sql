CREATE OR REPLACE FUNCTION public.answer_request(p_member uuid, p_accept boolean)
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
  update public.follows
     set accepted_at = case when p_accept then now() end,
         declined_at = case when p_accept then null else now() end
   where follower_id = p_member and followee_id = v_caller
     and accepted_at is null and declined_at is null;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
end;
$function$
;
