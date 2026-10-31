CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
begin
  perform public.signup_invite(new.raw_user_meta_data, false);

  -- Unless the address arrives proved: a user created from the dashboard or by
  -- the seed, or a stack running with email confirmations off. Then there is no
  -- second chance.
  if new.email_confirmed_at is not null then
    perform public.admit_user(new.id, new.raw_user_meta_data);
  end if;

  return new;
end;
$function$
;
