CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_gone integer;
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  delete from public.push_subscriptions where member_id = v_member and endpoint = p_endpoint;
  get diagnostics v_gone = row_count;
  return v_gone > 0;
end
$function$
;
