CREATE OR REPLACE FUNCTION public.set_entry_format(p_entry_id uuid, p_format book_format)
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

  update public.library_entries e
     set format_override = case when p_format is distinct from b.format then p_format end
    from public.books b
   where e.id = p_entry_id and e.member_id = v_member and b.id = e.book_id
  returning e.* into v_entry;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  return v_entry;
end;
$function$
;
