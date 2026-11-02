CREATE OR REPLACE FUNCTION private.buddy_invite(p_read uuid, p_host uuid, p_members uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_new     uuid[];
  v_skipped uuid[];
  v_in      uuid[];
  v_rows    integer;
begin
  -- At most 11 can ever join her: a longer list is full before it is read.
  if cardinality(p_members) > 12 then
    raise exception 'buddy_read_full' using errcode = 'PT409';
  end if;
  with asked as (
    select distinct m as member_id from unnest(coalesce(p_members, '{}')) m where m is not null
  ), sorted as (
    select a.member_id,
           exists (select 1 from public.buddy_read_members x
                    where x.buddy_read_id = p_read and x.member_id = a.member_id) as present,
           a.member_id <> p_host
             and exists (select 1 from public.follows f
                          where f.follower_id = p_host and f.followee_id = a.member_id and f.accepted_at is not null)
             and not exists (select 1 from public.buddy_read_members x
                              where x.buddy_read_id = p_read and x.member_id <> a.member_id
                                and private.blocked_either(x.member_id, a.member_id)) as eligible
      from asked a
  )
  select coalesce(array_agg(member_id order by member_id) filter (where not present and eligible), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where not present and not eligible), '{}'),
         coalesce(array_agg(member_id order by member_id) filter (where present), '{}')
    into v_new, v_skipped, v_in
    from sorted;

  if cardinality(v_new) > 0 then
    select count(*) into v_rows from public.buddy_read_members where buddy_read_id = p_read;
    if v_rows + cardinality(v_new) > 12 then
      raise exception 'buddy_read_full' using errcode = 'PT409';
    end if;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, invited_by)
    select p_read, m, 'member', p_host from unnest(v_new) m;
  end if;

  return jsonb_build_object(
    'invited', to_jsonb((select coalesce(array_agg(m order by m), '{}') from unnest(v_in || v_new) m)),
    'skipped', to_jsonb(v_skipped)
  );
end;
$function$
;
