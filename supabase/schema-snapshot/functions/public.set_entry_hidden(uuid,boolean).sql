CREATE OR REPLACE FUNCTION public.set_entry_hidden(p_entry uuid, p_hidden boolean)
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
  -- A null leaves the Book as it is: a missing value must never show what she hid.
  update public.library_entries
     set hidden = coalesce(p_hidden, hidden)
   where id = p_entry and member_id = v_member;
  if not found then
    raise exception 'entry_not_found' using errcode = 'PT404';
  end if;
end;
$function$
;
