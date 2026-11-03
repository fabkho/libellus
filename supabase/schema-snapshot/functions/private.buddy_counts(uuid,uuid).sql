CREATE OR REPLACE FUNCTION private.buddy_counts(p_read uuid, p_caller uuid)
 RETURNS TABLE(section_id uuid, total integer, unread integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with me as (
    select m.joined_at, m.last_read_at
      from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.member_id = p_caller and m.joined_at is not null
  ), hidden as (
    select b.blocked_id as id from public.blocks b where b.blocker_id = p_caller
    union
    select b.blocker_id from public.blocks b where b.blocked_id = p_caller
  )
  select x.section_id,
         count(*)::integer,
         (count(*) filter (
            where x.author_id <> p_caller
              and x.created_at > coalesce(case when x.section_id is null then me.last_read_at else c.last_read_at end,
                                          me.joined_at)))::integer
    from public.buddy_messages x
    cross join me
    left join public.buddy_section_cursors c on c.section_id = x.section_id and c.member_id = p_caller
   where x.buddy_read_id = p_read
     and x.deleted_at is null
     and x.author_id not in (select h.id from hidden h)
   group by x.section_id
$function$
;
