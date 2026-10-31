CREATE OR REPLACE FUNCTION public.set_private(p_private boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set private = coalesce(p_private, private), updated_at = now()
   where member_id = v_member;
  if p_private is false then
    update public.follows
       set accepted_at = now()
     where followee_id = v_member and accepted_at is null and declined_at is null;
    -- A declined request does not survive: it would be the only "requested" left on a public
    -- account, and so tell the asker he was declined.
    delete from public.follows
     where followee_id = v_member and accepted_at is null and declined_at is not null;
  elsif p_private is true then
    delete from public.likes l
     using public.reading_sessions s, public.library_entries e
     where s.id = l.session_id
       and e.id = s.entry_id
       and e.member_id = v_member
       and not exists (select 1 from public.follows f
                        where f.follower_id = l.member_id and f.followee_id = v_member and f.accepted_at is not null);
  end if;
  return private.my_social_json(v_member);
end;
$function$
;
