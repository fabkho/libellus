CREATE OR REPLACE FUNCTION public.my_people()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'following', private.people_page(v_caller, 'following', null, null, 30),
    'followers', private.people_page(v_caller, 'followers', null, null, 30),
    'followingIds', coalesce((
      select jsonb_agg(f.followee_id order by f.accepted_at desc, f.followee_id desc)
        from public.follows f
       where f.follower_id = v_caller and f.accepted_at is not null
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.follower_id)
                       || jsonb_build_object('askedAt', f.requested_at)
                       order by f.requested_at desc, f.follower_id)
        from public.follows f
       where f.followee_id = v_caller and f.accepted_at is null and f.declined_at is null
    ), '[]'::jsonb),
    'requested', coalesce((
      select jsonb_agg(private.member_card(v_caller, f.followee_id)
                       order by private.member_name(f.followee_id) nulls last, f.followee_id)
        from public.follows f
       where f.follower_id = v_caller and f.accepted_at is null
    ), '[]'::jsonb)
  );
end;
$function$
;
