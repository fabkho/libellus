CREATE OR REPLACE FUNCTION private.people_page(p_caller uuid, p_list text, p_before timestamp with time zone, p_before_id uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if p_list = 'following' then
    return coalesce((
      select jsonb_agg(private.member_card(p_caller, t.id)
                       || jsonb_build_object(
                            'at', t.at,
                            'followsYou', exists (
                              select 1 from public.follows b
                               where b.follower_id = t.id and b.followee_id = p_caller
                                 and b.accepted_at is not null))
                       order by t.at desc, t.id desc)
        from (
          select f.followee_id as id, f.accepted_at as at
            from public.follows f
           where f.follower_id = p_caller and f.accepted_at is not null
             and (p_before is null
                  or f.accepted_at < p_before
                  or (p_before_id is not null and f.accepted_at = p_before and f.followee_id < p_before_id))
           order by f.accepted_at desc, f.followee_id desc
           limit p_limit
        ) t
    ), '[]'::jsonb);
  end if;

  return coalesce((
    select jsonb_agg(private.member_card(p_caller, t.id)
                     || jsonb_build_object(
                          'at', t.at,
                          'followsBack', exists (
                            select 1 from public.follows b
                             where b.follower_id = p_caller and b.followee_id = t.id
                               and b.accepted_at is not null))
                     order by t.at desc, t.id desc)
      from (
        select f.follower_id as id, f.accepted_at as at
          from public.follows f
         where f.followee_id = p_caller and f.accepted_at is not null
           and (p_before is null
                or f.accepted_at < p_before
                or (p_before_id is not null and f.accepted_at = p_before and f.follower_id < p_before_id))
         order by f.accepted_at desc, f.follower_id desc
         limit p_limit
      ) t
  ), '[]'::jsonb);
end;
$function$
;
