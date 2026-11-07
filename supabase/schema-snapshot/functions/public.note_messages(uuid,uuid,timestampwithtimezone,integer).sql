CREATE OR REPLACE FUNCTION public.note_messages(p_room uuid, p_section uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sections s
                   join public.rooms r on r.id = s.room_id
                  where s.id = p_section and s.room_id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  return coalesce((
    select jsonb_agg(private.note_json(v_caller, m) order by m.created_at desc, m.id desc)
      from (select n.*
              from private.visible_notes(v_caller, p_room) n
             where n.section_id = p_section
               and (p_before is null or n.created_at < p_before)
             order by n.created_at desc, n.id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
  ), '[]'::jsonb);
end;
$function$
;
