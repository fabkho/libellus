CREATE OR REPLACE FUNCTION public.enrich_refresh(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with queued as (
    insert into private.enrich_queue (book_id, reason)
    select be.book_id, 'refresh'
      from public.book_enrichment be
     where be.enriched_at < now() - interval '30 days'
       and not exists (select 1 from private.enrich_queue q where q.book_id = be.book_id)
     order by be.enriched_at
     limit greatest(0, coalesce(p_limit, 100))
    on conflict (book_id) do nothing
    returning 1
  )
  select count(*)::integer from queued
$function$
;
