CREATE OR REPLACE FUNCTION private.buddy_reactions_json(p_caller uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine)
                            order by array_position(array['❤️', '😂', '😮', '😢', '🔥', '📚'], x.emoji)), '[]'::jsonb)
    from (select r.emoji, count(*)::integer as n, bool_or(r.member_id = p_caller) as mine
            from public.buddy_reactions r
           where r.message_id = p_message and not private.buddy_hidden(p_caller, r.member_id)
           group by r.emoji) x
$function$
;
