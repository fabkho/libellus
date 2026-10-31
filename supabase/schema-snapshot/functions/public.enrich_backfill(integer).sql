CREATE OR REPLACE FUNCTION public.enrich_backfill(p_limit integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with queued as (
    insert into private.enrich_queue (book_id, reason)
    select b.id, 'backfill'
      from public.books b
     where b.owner_id is null
       and not exists (select 1 from public.book_enrichment be where be.book_id = b.id)
       and not exists (select 1 from private.enrich_queue q where q.book_id = b.id)
     order by b.created_at
     limit p_limit
    on conflict (book_id) do nothing
    returning 1
  )
  select count(*)::integer from queued
$function$
;
