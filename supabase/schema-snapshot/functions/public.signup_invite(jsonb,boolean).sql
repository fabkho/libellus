CREATE OR REPLACE FUNCTION public.signup_invite(p_meta jsonb, p_lock boolean)
 RETURNS invite_codes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
declare
  v_code text := nullif(trim(p_meta ->> 'invite_code'), '');
  v_invite public.invite_codes%rowtype;
begin
  if v_code is null then
    raise exception 'invite_code_required' using errcode = 'check_violation';
  end if;

  if p_lock then
    select * into v_invite from public.invite_codes where code = v_code::citext for update;
  else
    select * into v_invite from public.invite_codes where code = v_code::citext;
  end if;

  if not found then
    raise exception 'invite_code_invalid' using errcode = 'check_violation';
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'invite_code_expired' using errcode = 'check_violation';
  end if;
  if v_invite.uses >= v_invite.max_uses then
    raise exception 'invite_code_exhausted' using errcode = 'check_violation';
  end if;

  return v_invite;
end;
$function$
;
