CREATE OR REPLACE FUNCTION private.reachable(p_caller uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select p_caller is not null and p_owner is not null and p_caller <> p_owner
     and not private.blocked_either(p_caller, p_owner)
     and (
       not (private.social_of(p_owner)).private
       or exists (select 1 from public.follows
                   where (follower_id = p_caller and followee_id = p_owner)
                      or (follower_id = p_owner and followee_id = p_caller))
       or exists (select 1 from public.follow_link_views where visitor_id = p_caller and member_id = p_owner)
     )
$function$
;
