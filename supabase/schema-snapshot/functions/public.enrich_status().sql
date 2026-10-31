CREATE OR REPLACE FUNCTION public.enrich_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_build_object(
    'queued', (select count(*) from private.enrich_queue),
    'due', (select count(*) from private.enrich_queue where not_before <= now()
                                                     and (claimed_until is null or claimed_until < now())),
    'catalogue', (select count(*) from public.books where owner_id is null),
    'enriched', (select count(*) from public.book_enrichment where status = 'enriched'),
    'notFound', (select count(*) from public.book_enrichment where status = 'not_found'),
    'failed', (select count(*) from public.book_enrichment where status = 'failed')
  )
$function$
;
