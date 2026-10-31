CREATE OR REPLACE FUNCTION public.cover_gc_done(p_keys text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  delete from private.cover_objects o
   where o.key = any (coalesce(p_keys, '{}'))
     and o.deleting_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$
;
