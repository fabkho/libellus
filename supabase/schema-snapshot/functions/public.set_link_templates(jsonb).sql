CREATE OR REPLACE FUNCTION public.set_link_templates(p_templates jsonb)
 RETURNS link_templates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_clean  jsonb;
  v_row    public.link_templates;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.link_templates_valid(p_templates) then
    raise exception 'link_templates_invalid' using errcode = '22023';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('label', btrim(item ->> 'label'), 'url', btrim(item ->> 'url')) order by position),
           '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(p_templates) with ordinality as t(item, position);

  insert into public.link_templates as l (member_id, templates, updated_at)
  values (v_member, v_clean, now())
  on conflict (member_id) do update
    set templates = excluded.templates, updated_at = excluded.updated_at
  returning l.* into v_row;
  return v_row;
end;
$function$
;
