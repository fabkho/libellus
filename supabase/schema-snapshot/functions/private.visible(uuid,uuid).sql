CREATE OR REPLACE FUNCTION private.visible(p_caller uuid, p_owner uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select private.reachable(p_caller, p_owner)
     and (
       not (private.social_of(p_owner)).private
       or exists (select 1 from public.follows
                   where follower_id = p_caller and followee_id = p_owner and accepted_at is not null)
     )
$function$
;
