CREATE OR REPLACE FUNCTION public.unblock(p_member uuid)
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
  delete from public.blocks where blocker_id = v_caller and blocked_id = p_member;
end;
$function$
;
