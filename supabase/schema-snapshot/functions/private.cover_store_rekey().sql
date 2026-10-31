CREATE OR REPLACE FUNCTION private.cover_store_rekey()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  update public.books set cover_key = null, cover_widths = null where cover_key is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$function$
;
