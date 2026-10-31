CREATE OR REPLACE FUNCTION public.circle_want(p_books uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return private.circle_of(v_caller, p_books, false);
end;
$function$
;
