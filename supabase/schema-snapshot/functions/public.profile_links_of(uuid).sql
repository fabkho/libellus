CREATE OR REPLACE FUNCTION public.profile_links_of(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller     uuid := auth.uid();
  v_visibility text;
  v_allowed    boolean;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_member is null then
    return '[]'::jsonb;
  end if;
  if v_caller = p_member then
    return private.my_profile_links_json(v_caller) -> 'links';
  end if;

  select coalesce(
           (select s.visibility from public.profile_link_settings s where s.member_id = p_member),
           'followers')
    into v_visibility;
  v_allowed := case v_visibility
    when 'everyone' then private.visible(v_caller, p_member)
    when 'followers' then private.reachable(v_caller, p_member)
                          and exists (select 1 from public.follows f
                                       where f.follower_id = v_caller and f.followee_id = p_member
                                         and f.accepted_at is not null)
    else false
  end;
  if not coalesce(v_allowed, false) then
    return '[]'::jsonb;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('platform', l.platform, 'handle', l.handle)
                                    order by l.platform)
                     from public.profile_links l where l.member_id = p_member), '[]'::jsonb);
end;
$function$
;
