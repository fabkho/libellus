CREATE OR REPLACE FUNCTION public.owner_waitlist_set_invited(p_ids uuid[], p_invited boolean DEFAULT true)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_changed integer;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  update private.waitlist w
     set invited_at = case when coalesce(p_invited, true) then coalesce(w.invited_at, now()) end
   where w.id = any (coalesce(p_ids, '{}'));
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$function$
;
