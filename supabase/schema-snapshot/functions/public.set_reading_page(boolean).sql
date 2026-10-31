CREATE OR REPLACE FUNCTION public.set_reading_page(p_on boolean)
 RETURNS reading_pages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_member uuid := auth.uid();
  v_row    public.reading_pages;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  insert into public.reading_pages as p (member_id, token)
  values (v_member, case when p_on then private.reading_page_token() end)
  on conflict (member_id) do update
    set token = case when p_on then coalesce(p.token, excluded.token) end,
        updated_at = now()
  returning p.* into v_row;
  return v_row;
end;
$function$
;
