CREATE OR REPLACE FUNCTION private.buddy_unread(p_read uuid, p_caller uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  with me as (
    select m.joined_at, m.last_read_at, m.read_through, private.buddy_parts(p_read) as parts
      from public.buddy_read_members m
     where m.buddy_read_id = p_read and m.member_id = p_caller and m.joined_at is not null
  ), hidden as (
    select coalesce(array_agg(h.id), '{}') as ids
      from (select b.blocked_id as id from public.blocks b where b.blocker_id = p_caller
            union
            select b.blocker_id from public.blocks b where b.blocked_id = p_caller) h
  ), open as (
    select s.id, coalesce(c.last_read_at, me.joined_at) as since
      from public.buddy_read_sections s
      cross join me
      left join public.buddy_section_cursors c on c.section_id = s.id and c.member_id = p_caller
     where s.buddy_read_id = p_read
       and ((s.kind = 'part' and s.position <= me.read_through)
            or (s.kind = 'end' and me.read_through >= me.parts))
  )
  select ((select count(*)
             from public.buddy_messages x, me, hidden
            where x.buddy_read_id = p_read and x.section_id is null
              and x.created_at > coalesce(me.last_read_at, me.joined_at)
              and x.deleted_at is null and x.author_id <> p_caller and not (x.author_id = any (hidden.ids)))
        + (select count(*)
             from open o
             join public.buddy_messages x on x.section_id = o.id and x.created_at > o.since
             cross join hidden
            where x.deleted_at is null and x.author_id <> p_caller and not (x.author_id = any (hidden.ids))))::integer
$function$
;
