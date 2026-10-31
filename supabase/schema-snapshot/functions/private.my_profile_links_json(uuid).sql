CREATE OR REPLACE FUNCTION private.my_profile_links_json(p_member uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'links', coalesce((select jsonb_agg(jsonb_build_object('platform', l.platform, 'handle', l.handle)
                                        order by l.platform)
                         from public.profile_links l where l.member_id = p_member), '[]'::jsonb),
    'visibility', coalesce((select s.visibility from public.profile_link_settings s where s.member_id = p_member),
                           'followers')
  )
$function$
;
