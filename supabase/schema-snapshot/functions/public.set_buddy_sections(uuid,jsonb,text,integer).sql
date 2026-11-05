CREATE OR REPLACE FUNCTION public.set_buddy_sections(p_id uuid, p_sections jsonb, p_from text DEFAULT 'count'::text, p_page_count integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_new    jsonb;
  v_same   boolean;
  v_parts  integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);
  if v_read.status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;

  select jsonb_agg(to_jsonb(s) order by s.s_position) into v_new
    from private.buddy_sections_parse(p_sections, coalesce(p_from, 'count'), p_page_count) s;

  with n as (
    select * from jsonb_to_recordset(v_new)
      as x(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
  )
  select (select count(*) from n) = (select count(*) from public.buddy_read_sections where buddy_read_id = p_id)
     and not exists (
       select 1 from n
         left join public.buddy_read_sections s
           on s.buddy_read_id = p_id and s.position = n.s_position and s.kind = n.s_kind and s.to_fraction = n.s_to_fraction
        where s.id is null)
    into v_same;

  if v_same then
    update public.buddy_read_sections s
       set label = n.s_label, start_page = n.s_start_page, end_page = n.s_end_page
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric)
     where s.buddy_read_id = p_id and s.position = n.s_position;
  else
    if exists (select 1 from public.buddy_messages where buddy_read_id = p_id and section_id is not null) then
      raise exception 'buddy_sections_locked' using errcode = 'PT409';
    end if;
    delete from public.buddy_read_sections where buddy_read_id = p_id;
    insert into public.buddy_read_sections (buddy_read_id, position, kind, label, start_page, end_page, to_fraction)
    select p_id, n.s_position, n.s_kind, n.s_label, n.s_start_page, n.s_end_page, n.s_to_fraction
      from jsonb_to_recordset(v_new)
        as n(s_position smallint, s_kind text, s_label text, s_start_page integer, s_end_page integer, s_to_fraction numeric);
    v_parts := private.buddy_parts(p_id);
    update public.buddy_read_members set hand_through = v_parts
     where buddy_read_id = p_id and hand_through > v_parts;
  end if;

  update public.buddy_reads set sections_from = coalesce(p_from, 'count'), page_count = p_page_count where id = p_id;
  return public.buddy_read(p_id);
end;
$function$
;
