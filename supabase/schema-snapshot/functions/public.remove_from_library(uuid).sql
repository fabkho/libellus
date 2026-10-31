CREATE OR REPLACE FUNCTION public.remove_from_library(p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  delete from public.library_entries where id = p_entry_id and member_id = v_member;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
end;
$function$
;
