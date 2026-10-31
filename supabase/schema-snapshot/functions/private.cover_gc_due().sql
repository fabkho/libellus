CREATE OR REPLACE FUNCTION private.cover_gc_due()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from private.cover_objects o
     where o.orphaned_at < now() - interval '30 days'
       and (o.deleting_at is null or o.deleting_at < now() - interval '15 minutes')
       and (o.gc_retry_at is null or o.gc_retry_at <= now())
  )
$function$
;
