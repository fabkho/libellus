CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_locale text DEFAULT 'en'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth, locale)
  values (v_member, p_endpoint, p_p256dh, p_auth, coalesce(p_locale, 'en'))
  on conflict (endpoint) do update
     set member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, locale = excluded.locale,
         created_at = now(), last_ok_at = null;
  delete from public.push_subscriptions
   where member_id = v_member
     and id in (select id from public.push_subscriptions where member_id = v_member order by created_at desc, id offset 10);
end
$function$
;
