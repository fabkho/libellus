CREATE OR REPLACE FUNCTION public.enrich_failed(p_book uuid, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_attempts integer;
begin
  update private.enrich_queue
     set claimed_until = null,
         last_error = left(p_error, 500),
         not_before = now() + least(interval '10 minutes' * power(2, greatest(attempts - 1, 0)), interval '1 day')
   where book_id = p_book
  returning attempts into v_attempts;
  if v_attempts >= 6 then
    delete from private.enrich_queue where book_id = p_book;
    insert into public.book_enrichment (book_id, status, enriched_at)
    values (p_book, 'failed', now())
    on conflict (book_id) do update set status = 'failed', enriched_at = now()
     where public.book_enrichment.status <> 'enriched';
  end if;
end;
$function$
;
