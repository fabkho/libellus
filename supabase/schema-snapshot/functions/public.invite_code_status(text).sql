CREATE OR REPLACE FUNCTION public.invite_code_status(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform public.signup_invite(jsonb_build_object('invite_code', p_code), false);
  return 'valid';
exception when check_violation then
  return case sqlerrm
    when 'invite_code_required' then 'missing'
    when 'invite_code_expired' then 'expired'
    when 'invite_code_exhausted' then 'exhausted'
    else 'invalid'
  end;
end;
$function$
;
