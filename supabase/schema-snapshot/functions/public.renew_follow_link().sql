CREATE OR REPLACE FUNCTION public.renew_follow_link()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set follow_token = private.reading_page_token(), updated_at = now()
   where member_id = v_member;
  delete from public.follow_link_views v
   where v.member_id = v_member
     and not exists (
       select 1 from public.follows f
        where (f.follower_id = v.visitor_id and f.followee_id = v_member)
           or (f.follower_id = v_member and f.followee_id = v.visitor_id));
  return private.my_social_json(v_member);
end;
$function$
;
