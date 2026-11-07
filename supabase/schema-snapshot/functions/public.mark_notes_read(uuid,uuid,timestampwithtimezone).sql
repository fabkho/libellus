CREATE OR REPLACE FUNCTION public.mark_notes_read(p_room uuid, p_section uuid, p_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_to     timestamptz;
  v_at     timestamptz;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.room_sections s
                   join public.rooms r on r.id = s.room_id
                  where s.id = p_section and s.room_id = p_room and r.kind = 'notes') then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  v_to := greatest(clock_timestamp(), (select max(m.created_at) from public.room_messages m where m.section_id = p_section));
  v_to := least(coalesce(p_until, v_to), v_to);

  insert into public.room_cursors as c (section_id, member_id, last_read_at)
  values (p_section, v_caller, v_to)
  on conflict (section_id, member_id)
    do update set last_read_at = greatest(c.last_read_at, excluded.last_read_at)
  returning c.last_read_at into v_at;
  return jsonb_build_object('lastReadAt', v_at);
end;
$function$
;
