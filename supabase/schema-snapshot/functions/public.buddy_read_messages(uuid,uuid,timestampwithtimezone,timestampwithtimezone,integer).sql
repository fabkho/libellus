CREATE OR REPLACE FUNCTION public.buddy_read_messages(p_read uuid, p_section uuid DEFAULT NULL::uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 50)
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
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(private.buddy_message_json(v_caller, m) order by m.created_at desc, m.id desc)
      from (select *
              from public.buddy_messages x
             where x.buddy_read_id = p_read
               and x.section_id is not distinct from p_section
               and (p_before is null or x.created_at < p_before)
               and (p_after is null or x.created_at > p_after)
               and not private.buddy_hidden(v_caller, x.author_id)
             order by x.created_at desc, x.id desc
             limit least(greatest(coalesce(p_limit, 50), 1), 100)) m
  ), '[]'::jsonb);
end;
$function$
;
