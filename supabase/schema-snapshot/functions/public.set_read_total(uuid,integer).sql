CREATE OR REPLACE FUNCTION public.set_read_total(p_entry_id uuid, p_page_count integer DEFAULT NULL::integer)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member     uuid := auth.uid();
  v_book_count integer;
  v_override   integer;
  v_entry      public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_page_count is not null and p_page_count not between 1 and 99999 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  -- Locked, so a progress update from another device lands one after the other.
  select b.page_count into v_book_count
    from public.library_entries e
    join public.books b on b.id = e.book_id
   where e.id = p_entry_id and e.member_id = v_member
     for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- A total that only repeats the edition's is no override.
  v_override := case when p_page_count is not distinct from v_book_count then null else p_page_count end;

  update public.library_entries set page_count_override = v_override where id = p_entry_id
  returning * into v_entry;
  return v_entry;
end;
$function$
;
