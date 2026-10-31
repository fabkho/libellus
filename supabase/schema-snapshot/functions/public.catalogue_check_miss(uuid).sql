CREATE OR REPLACE FUNCTION public.catalogue_check_miss(p_book uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_found boolean;
begin
  update public.books
     set checked_at = now(), check_unknown = true, description = null
   where id = p_book and owner_id is null and checked_at is null;
  v_found := found;
  delete from private.catalogue_check_state where book_id = p_book;
  return v_found;
end;
$function$
;
