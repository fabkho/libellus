CREATE OR REPLACE FUNCTION public.set_reading_page_sections(p_sections jsonb)
 RETURNS reading_pages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_key    text;
  v_row    public.reading_pages;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_sections is null or jsonb_typeof(p_sections) <> 'object' then
    raise exception 'reading_page_sections_invalid' using errcode = '22023';
  end if;
  for v_key in select jsonb_object_keys(p_sections) loop
    if v_key not in ('reading', 'year', 'favourites', 'finished', 'shelf')
       or jsonb_typeof(p_sections -> v_key) <> 'boolean' then
      raise exception 'reading_page_sections_invalid' using errcode = '22023';
    end if;
  end loop;

  insert into public.reading_pages (member_id) values (v_member) on conflict (member_id) do nothing;
  update public.reading_pages
     set show_reading    = coalesce((p_sections ->> 'reading')::boolean, show_reading),
         show_year       = coalesce((p_sections ->> 'year')::boolean, show_year),
         show_favourites = coalesce((p_sections ->> 'favourites')::boolean, show_favourites),
         show_finished   = coalesce((p_sections ->> 'finished')::boolean, show_finished),
         show_shelf      = coalesce((p_sections ->> 'shelf')::boolean, show_shelf),
         updated_at      = now()
   where member_id = v_member
  returning * into v_row;
  return v_row;
end;
$function$
;
