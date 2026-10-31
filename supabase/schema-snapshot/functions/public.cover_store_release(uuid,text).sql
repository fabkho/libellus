CREATE OR REPLACE FUNCTION public.cover_store_release(p_book uuid, p_runner text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found uuid;
begin
  update private.cover_store_queue
     set state = 'queued', due_at = now(), leased_by = null, leased_until = null, last_error = null
   where book_id = p_book and state = 'leased' and leased_by = p_runner
  returning book_id into v_found;
  return v_found is not null;
end
$function$
;
