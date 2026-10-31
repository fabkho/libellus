CREATE OR REPLACE FUNCTION public.feedback_mark_handled(p_id uuid, p_handled boolean DEFAULT true)
 RETURNS boolean
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

  update public.feedback f
     set handled_at = case when coalesce(p_handled, true) then coalesce(f.handled_at, now()) end
   where f.id = p_id;
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$function$
;
