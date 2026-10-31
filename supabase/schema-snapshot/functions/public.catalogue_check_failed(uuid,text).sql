CREATE OR REPLACE FUNCTION public.catalogue_check_failed(p_book uuid, p_error text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
  update private.catalogue_check_state
     set claimed_until = null,
         last_error = left(p_error, 500),
         not_before = now() + least(interval '5 minutes' * power(2, least(greatest(attempts - 1, 0), 10)), interval '1 day')
   where book_id = p_book
$function$
;
