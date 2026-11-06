CREATE OR REPLACE FUNCTION private.mutual_friends(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (select 1 from public.follows f
                  where f.follower_id = p_a and f.followee_id = p_b and f.accepted_at is not null)
     and exists (select 1 from public.follows f
                  where f.follower_id = p_b and f.followee_id = p_a and f.accepted_at is not null)
$function$
;
