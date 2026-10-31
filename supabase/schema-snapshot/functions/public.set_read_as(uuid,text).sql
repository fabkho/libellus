CREATE OR REPLACE FUNCTION public.set_read_as(p_entry_id uuid, p_read_as text)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_read_as is not null and p_read_as not in ('physical', 'ebook', 'audiobook') then
    raise exception 'read_as_invalid' using errcode = '22023';
  end if;
  update public.library_entries
     set read_as = p_read_as
   where id = p_entry_id and member_id = v_member
  returning * into v_entry;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  return v_entry;
end;
$function$
;
