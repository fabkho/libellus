CREATE OR REPLACE FUNCTION public.catalogue_check_release(p_book uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  update private.catalogue_check_state
     set claimed_until = null, attempts = greatest(attempts - 1, 0)
   where book_id = p_book
$function$
;
