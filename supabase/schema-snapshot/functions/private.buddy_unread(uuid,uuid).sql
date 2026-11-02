CREATE OR REPLACE FUNCTION private.buddy_unread(p_read uuid, p_caller uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select coalesce(sum(c.unread), 0)::integer
    from private.buddy_counts(p_read, p_caller) c
    cross join (select m.read_through from public.buddy_read_members m
                 where m.buddy_read_id = p_read and m.member_id = p_caller) me
    left join public.buddy_read_sections s on s.id = c.section_id
   where c.section_id is null
      or (s.kind = 'part' and s.position <= me.read_through)
      or (s.kind = 'end' and me.read_through >= private.buddy_parts(p_read))
$function$
;
