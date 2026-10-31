CREATE OR REPLACE FUNCTION public.change_edition(p_entry_id uuid, p_book jsonb, p_format book_format DEFAULT NULL::book_format)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member  uuid := auth.uid();
  v_entry   public.library_entries;
  v_book_id uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  -- Locked, so a progress update or a second change from another device lands
  -- after this one.
  select * into v_entry from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  v_book_id := public.catalogue_book_for(p_book);
  if v_book_id = v_entry.book_id then
    return v_entry;
  end if;

  return public.move_entry_to(v_entry, v_book_id, p_format);
end;
$function$
;
