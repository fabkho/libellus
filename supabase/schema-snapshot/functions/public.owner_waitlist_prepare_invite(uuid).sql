CREATE OR REPLACE FUNCTION public.owner_waitlist_prepare_invite(p_id uuid)
 RETURNS TABLE(email text, code text, expires_at timestamp with time zone, locale text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_email   text;
  v_locale  text;
  v_code_id uuid;
  v_code    public.invite_codes;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  -- Locked, so two Invites at once (two devices, a double tap) share one code.
  select w.email::text, w.invite_code_id, w.locale into v_email, v_code_id, v_locale
    from private.waitlist w where w.id = p_id
     for update;
  if not found then
    raise exception 'waitlist_entry_not_found' using errcode = 'P0002';
  end if;

  if v_code_id is not null then
    select c.* into v_code from public.invite_codes c
     where c.id = v_code_id
       and c.uses = 0
       and (c.expires_at is null or c.expires_at > now());
  end if;

  if v_code.id is null then
    -- A fresh code: one use, 14 days, no address in its label (the label is the operator's, read in plain sight).
    v_code := public.create_invite_code(1, now() + interval '14 days', 'waitlist', null);
    update private.waitlist w set invite_code_id = v_code.id where w.id = p_id;
  end if;

  return query select v_email, v_code.code::text, v_code.expires_at, v_locale;
end;
$function$
;
