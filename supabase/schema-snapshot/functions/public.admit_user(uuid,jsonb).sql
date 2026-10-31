CREATE OR REPLACE FUNCTION public.admit_user(p_id uuid, p_meta jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_invite public.invite_codes%rowtype;
begin
  -- An address can be confirmed more than once (an email change, a row fixed by
  -- hand). The invite was already paid for the first time.
  if exists (select 1 from public.accounts where id = p_id) then
    return;
  end if;

  v_invite := public.signup_invite(p_meta, true);

  update public.invite_codes set uses = uses + 1 where id = v_invite.id;
  insert into public.accounts (id, invite_code_id) values (p_id, v_invite.id);
end;
$function$
;
