CREATE OR REPLACE FUNCTION public.owner_waitlist_delete(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_deleted integer;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  delete from private.waitlist w where w.id = p_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$
;
