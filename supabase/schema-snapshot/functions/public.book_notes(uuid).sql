CREATE OR REPLACE FUNCTION public.book_notes(p_book uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_key    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if not found or (v_owner is not null and v_owner <> v_caller) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  v_key := private.book_work_key(p_book);
  if v_key is null then
    raise exception 'notes_unavailable' using errcode = '22023';
  end if;
  return private.notes_page(v_caller, v_key, (private.notes_room_for(p_book)).id);
end;
$function$
;
