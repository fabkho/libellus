CREATE OR REPLACE FUNCTION public.cover_store_reserve(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
begin
  insert into private.cover_objects as o (key) values (p_key)
  on conflict (key) do update set orphaned_at = null where o.deleting_at is null
  returning o.key into v_key;
  return v_key is not null;
end
$function$
;
