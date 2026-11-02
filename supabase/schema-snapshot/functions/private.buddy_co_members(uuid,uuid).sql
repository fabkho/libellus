CREATE OR REPLACE FUNCTION private.buddy_co_members(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select p_a is not null and p_b is not null and p_a <> p_b
     and exists (
       select 1
         from public.buddy_read_members x
         join public.buddy_read_members y on y.buddy_read_id = x.buddy_read_id
        where x.member_id = p_a and x.joined_at is not null
          and y.member_id = p_b and y.joined_at is not null
     )
     and not private.blocked_either(p_a, p_b)
$function$
;
