CREATE OR REPLACE FUNCTION public.renew_reading_page_link()
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
  update public.reading_pages
     set token = private.reading_page_token(), updated_at = now()
   where member_id = v_member and token is not null
  returning * into v_row;
  if not found then
    raise exception 'reading_page_off' using errcode = '22023';
  end if;
  return v_row;
end;
$function$
;
